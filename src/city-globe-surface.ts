import * as THREE from 'three';

import { cityImageryUrlTemplate, cityImageryMinZoom, cityImageryMaxZoom, cityImageryBounds, cityOverviewUrlTemplate, cityOverviewMaxZoom } from './city-imagery';
const maxTiles = 128;
const maxRequests = 6;
const mercatorLimit = Math.atan(Math.sinh(Math.PI));
const mercatorY = (latitude: number) => (1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2;
const detailTop = mercatorY(cityImageryBounds[1][0] * Math.PI / 180);
const detailBottom = mercatorY(cityImageryBounds[0][0] * Math.PI / 180);
type Tile = {
  key: string;
  zoom: number;
  x: number;
  y: number;
  used: number;
  controller?: AbortController;
  mesh?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  bitmap?: ImageBitmap;
  failed?: boolean;
};

/** A bounded, view-driven imagery layer; it never receives a practice target. */
export class CityGlobeSurface {
  readonly group = new THREE.Group();
  private readonly tiles = new Map<string, Tile>();
  private readonly wanted = new Set<string>();
  private readonly queue: Tile[] = [];
  private readonly previousPosition = new THREE.Vector3();
  private previousHeight = 0;
  private previousAspect = 0;
  private viewKey = '';
  private generation = 0;
  private pending = 0;
  private active = false;
  private disposed = false;

  constructor(
    private readonly changed: () => void,
    private readonly anisotropy: number,
    private readonly unavailable: () => void,
  ) {}

  setActive(active: boolean) {
    if (active === this.active || this.disposed) return;
    this.active = active;
    this.group.visible = active;
    if (active) {
      this.previousHeight = 0;
      this.viewKey = '';
      return;
    }
    this.queue.length = 0;
    for (const [key, tile] of this.tiles) {
      if (!tile.controller) continue;
      tile.controller.abort();
      this.tiles.delete(key);
    }
  }

  update(camera: THREE.PerspectiveCamera, pixelHeight: number) {
    if (!this.active || this.disposed || !pixelHeight) return;
    const distance = camera.position.length();
    const altitude = distance - 1;
    // Ignore subpixel camera changes, but never skip resize or zoom changes.
    if (this.previousHeight === pixelHeight && this.previousAspect === camera.aspect &&
      this.previousPosition.distanceToSquared(camera.position) < (altitude / pixelHeight / 2) ** 2) return;
    this.previousPosition.copy(camera.position);
    this.previousHeight = pixelHeight;
    this.previousAspect = camera.aspect;
    this.generation++;
    const latitude = Math.asin(THREE.MathUtils.clamp(camera.position.y / distance, -1, 1));
    const longitude = Math.atan2(camera.position.x, camera.position.z);
    const tangent = Math.tan(camera.fov * Math.PI / 360);
    const cornerAngle = Math.atan(tangent * Math.hypot(1, camera.aspect));
    const radius = distance * Math.sin(cornerAngle) >= 1
      ? Math.acos(1 / distance)
      : Math.asin(distance * Math.sin(cornerAngle)) - cornerAngle;
    const south = Math.max(-mercatorLimit, latitude - radius);
    const north = Math.min(mercatorLimit, latitude + radius);
    const longitudeRadius = Math.abs(latitude) + radius >= Math.PI / 2
      ? Math.PI : Math.asin(Math.min(1, Math.sin(radius) / Math.cos(latitude)));
    let zoom = THREE.MathUtils.clamp(Math.ceil(Math.log2(
      2 * Math.PI * Math.max(0.02, Math.cos(latitude)) * pixelHeight / (256 * 2 * altitude * tangent),
    )), 0, cityImageryMaxZoom);
    let count: number;
    let left: number;
    let right: number;
    let top: number;
    let bottom: number;
    do {
      count = 2 ** zoom;
      left = Math.floor((longitude - longitudeRadius + Math.PI) / (2 * Math.PI) * count);
      right = Math.min(left + count - 1, Math.floor((longitude + longitudeRadius + Math.PI) / (2 * Math.PI) * count));
      top = THREE.MathUtils.clamp(Math.floor(mercatorY(north) * count), 0, count - 1);
      bottom = THREE.MathUtils.clamp(Math.floor(mercatorY(south) * count), 0, count - 1);
      if ((right - left + 1) * (bottom - top + 1) <= 32 || zoom === 0) break;
      zoom--;
    } while (true);
    const viewKey = `${zoom}/${left}/${right}/${top}/${bottom}`;
    if (viewKey === this.viewKey) return;
    this.viewKey = viewKey;

    this.wanted.clear();
    this.queue.length = 0;
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        // Retain ancestors as a progressive fallback while finer tiles arrive.
        const wrappedX = (x % count + count) % count;
        for (let level = 0; level <= zoom; level++) {
          const divisor = 2 ** (zoom - level);
          const tileX = Math.floor(wrappedX / divisor);
          const tileY = Math.floor(y / divisor);
          // Overview covers the whole Mercator world; only detail is limited
          // to the advertised Sentinel-2 latitude range.
          if (level >= cityImageryMinZoom &&
            ((tileY + 1) / 2 ** level <= detailTop || tileY / 2 ** level >= detailBottom)) continue;
          const key = `${level}/${tileY}/${tileX}`;
          if (this.wanted.has(key)) continue;
          this.wanted.add(key);
          let tile = this.tiles.get(key);
          if (!tile) {
            tile = { key, zoom: level, x: tileX, y: tileY, used: this.generation };
            this.tiles.set(key, tile);
          }
          tile.used = this.generation;
          if (!tile.mesh && !tile.controller && !tile.failed) this.queue.push(tile);
        }
      }
    }
    for (const [key, tile] of this.tiles) {
      const visible = this.wanted.has(key);
      if (!visible && tile.controller) {
        tile.controller.abort();
        this.tiles.delete(key);
      }
    }
    if (this.tiles.size > maxTiles) {
      const unused = [...this.tiles.values()].filter(tile => !this.wanted.has(tile.key)).sort((a, b) => a.used - b.used);
      for (const tile of unused) {
        if (this.tiles.size <= maxTiles) break;
        this.release(tile);
        this.tiles.delete(tile.key);
      }
    }
    this.updateVisibility();
    this.queue.sort((a, b) => a.zoom - b.zoom);
    this.pump();
  }

  private updateVisibility() {
    for (const tile of this.tiles.values()) {
      if (!tile.mesh) continue;
      tile.mesh.visible = this.wanted.has(tile.key);
      if (!tile.mesh.visible) continue;
      // The overview must survive fully loaded detail: Sentinel-2 has
      // transparent ocean/no-data pixels, not an opaque replacement basemap.
      if (tile.zoom === cityOverviewMaxZoom) continue;
      let children = 0;
      let covered = true;
      for (let index = 0; index < 4; index++) {
        const key = `${tile.zoom + 1}/${tile.y * 2 + (index >> 1)}/${tile.x * 2 + (index & 1)}`;
        if (!this.wanted.has(key)) continue;
        children++;
        if (!this.tiles.get(key)?.mesh) covered = false;
      }
      // Once the visible children are ready, the parent no longer fills any
      // gap. Retiring it also prevents resampled alpha edges accumulating.
      if (children && covered) tile.mesh.visible = false;
    }
  }

  private pump() {
    while (this.active && !this.disposed && this.pending < maxRequests && this.queue.length) {
      const tile = this.queue.shift()!;
      if (!this.wanted.has(tile.key) || tile.controller || tile.mesh) continue;
      const controller = new AbortController();
      tile.controller = controller;
      this.pending++;
      void this.load(tile, controller);
    }
  }

  private async load(tile: Tile, controller: AbortController) {
    let bitmap: ImageBitmap | undefined;
    try {
      const template = tile.zoom <= cityOverviewMaxZoom ? cityOverviewUrlTemplate : cityImageryUrlTemplate;
      const url = template.replace('{z}', String(tile.zoom)).replace('{x}', String(tile.x)).replace('{y}', String(tile.y));
      const response = await fetch(url, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      if (!response.ok) throw new Error(`Imagery unavailable: ${response.status}`);
      bitmap = await createImageBitmap(await response.blob(), { imageOrientation: 'flipY' });
      if (controller.signal.aborted || !this.active || this.disposed || this.tiles.get(tile.key) !== tile) {
        bitmap.close();
        return;
      }
      const texture = new THREE.Texture(bitmap);
      texture.flipY = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = this.anisotropy;
      texture.needsUpdate = true;
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
      tile.mesh = new THREE.Mesh(this.geometry(tile), material);
      // Back-face culling follows the curved surface. Transparent no-data
      // retains geographic context beneath the finest available imagery.
      tile.mesh.renderOrder = tile.zoom + 1;
      tile.bitmap = bitmap;
      this.group.add(tile.mesh);
      this.updateVisibility();
      this.changed();
    } catch {
      bitmap?.close();
      // Keep geographic context available when the external imagery is offline;
      // a failed tile is not retried on every animation frame.
      if (!controller.signal.aborted) {
        tile.failed = true;
        this.unavailable();
      }
    } finally {
      tile.controller = undefined;
      this.pending--;
      this.pump();
    }
  }

  private geometry(tile: Tile) {
    const count = 2 ** tile.zoom;
    const segments = Math.max(1, Math.ceil(256 / count));
    const positions = new Float32Array((segments + 1) ** 2 * 3);
    const uvs = new Float32Array((segments + 1) ** 2 * 2);
    const indices = new Uint32Array(segments ** 2 * 6);
    let vertex = 0;
    let index = 0;
    for (let row = 0; row <= segments; row++) {
      const v = row / segments;
      const latitude = Math.atan(Math.sinh(Math.PI * (1 - 2 * (tile.y + v) / count)));
      const cosine = Math.cos(latitude);
      for (let column = 0; column <= segments; column++) {
        const u = column / segments;
        const longitude = (tile.x + u) / count * Math.PI * 2 - Math.PI;
        positions[vertex * 3] = cosine * Math.sin(longitude);
        positions[vertex * 3 + 1] = Math.sin(latitude);
        positions[vertex * 3 + 2] = cosine * Math.cos(longitude);
        uvs[vertex * 2] = u;
        uvs[vertex * 2 + 1] = 1 - v;
        if (row < segments && column < segments) {
          const below = vertex + segments + 1;
          indices[index++] = vertex;
          indices[index++] = below;
          indices[index++] = vertex + 1;
          indices[index++] = vertex + 1;
          indices[index++] = below;
          indices[index++] = below + 1;
        }
        vertex++;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();
    return geometry;
  }

  private release(tile: Tile) {
    tile.controller?.abort();
    if (tile.mesh) {
      this.group.remove(tile.mesh);
      tile.mesh.geometry.dispose();
      tile.mesh.material.map?.dispose();
      tile.mesh.material.dispose();
    }
    tile.bitmap?.close();
  }

  dispose() {
    this.disposed = true;
    this.active = false;
    this.queue.length = 0;
    for (const tile of this.tiles.values()) this.release(tile);
    this.tiles.clear();
    this.wanted.clear();
    this.group.clear();
  }
}
