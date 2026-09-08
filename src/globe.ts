import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { countries, polygonArea, type Country } from './geography';

type Point = { longitude: number; latitude: number };
type Answer = Point & { correct: boolean };
const radians = Math.PI / 180;

function position(point: Point, radius = 1): THREE.Vector3 {
  const latitude = point.latitude * radians;
  const longitude = point.longitude * radians;
  return new THREE.Vector3(Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude), Math.cos(latitude) * Math.cos(longitude)).multiplyScalar(radius);
}

function geographic(point: THREE.Vector3): Point {
  return { longitude: Math.atan2(point.x, point.z) / radians, latitude: Math.asin(THREE.MathUtils.clamp(point.y / point.length(), -1, 1)) / radians };
}

// Only geographic coordinates cross this presentation boundary. Evaluation,
// learning-item identity, assistance, and scheduling remain in LearnerSession.
export class Globe {
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.01, 20);
  private readonly controls: OrbitControls;
  private readonly texture: THREE.CanvasTexture;
  private readonly surface: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly pin = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 12), new THREE.MeshBasicMaterial({ color: '#d6ef87' }));
  private readonly raycaster = new THREE.Raycaster();
  private readonly observer: ResizeObserver;
  private active = false;
  private disposed = false;
  private highlighted?: Country;

  constructor(private readonly container: HTMLElement, onSelect: (point: Point) => void, onUnavailable: () => void) {
    const canvas = this.renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', 'Interactive globe');
    canvas.setAttribute('aria-describedby', 'globe-instructions');
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera.position.copy(position({ longitude: 0, latitude: 15 }, 3));
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    this.controls.minDistance = 1.15;
    this.controls.maxDistance = 4;
    this.controls.enableDamping = false;
    this.controls.update();
    const atlas = document.createElement('canvas');
    atlas.width = Math.min(8192, this.renderer.capabilities.maxTextureSize);
    atlas.height = atlas.width / 2;
    this.texture = new THREE.CanvasTexture(atlas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.surface = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), new THREE.MeshBasicMaterial({ map: this.texture }));
    // Three's sphere UV seam starts on -X; the geographic seam is 180°.
    this.surface.rotation.y = -Math.PI / 2;
    this.scene.add(this.surface, this.pin);
    this.pin.visible = false;
    this.paint();
    container.prepend(canvas);
    this.controls.addEventListener('change', this.render);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      onUnavailable();
    });
    // A drag, pinch, or cancelled gesture must never drop an answer pin.
    const pointers = new Set<number>();
    let origin = { x: 0, y: 0 };
    let moved = false;
    canvas.addEventListener('pointerdown', event => {
      pointers.add(event.pointerId);
      if (pointers.size === 1) {
        origin = { x: event.clientX, y: event.clientY };
        moved = event.button !== 0;
      } else moved = true;
    });
    canvas.addEventListener('pointermove', event => {
      if (pointers.has(event.pointerId) && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 5) moved = true;
    });
    canvas.addEventListener('pointercancel', event => { pointers.delete(event.pointerId); moved = true; });
    canvas.addEventListener('pointerup', event => {
      const wasDown = pointers.delete(event.pointerId);
      if (!wasDown || moved || pointers.size || !this.active) return;
      const bounds = canvas.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2), this.camera);
      // Intersect the mathematical sphere, not the tessellated display mesh.
      const hit = this.raycaster.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), 1), new THREE.Vector3());
      if (hit) onSelect(geographic(hit));
    });
    canvas.addEventListener('keydown', event => {
      const point = geographic(this.camera.position);
      if (event.key === 'ArrowLeft') point.longitude -= 15;
      else if (event.key === 'ArrowRight') point.longitude += 15;
      else if (event.key === 'ArrowUp') point.latitude = Math.min(85, point.latitude + 15);
      else if (event.key === 'ArrowDown') point.latitude = Math.max(-85, point.latitude - 15);
      else if (event.key === '+' || event.key === '=') this.zoom(0.8);
      else if (event.key === '-') this.zoom(1.25);
      else if (event.key === 'Enter' || event.key === ' ') onSelect(point);
      else return;
      event.preventDefault();
      if (event.key.startsWith('Arrow')) {
        this.camera.position.copy(position(point, this.camera.position.length()));
        this.controls.update();
      }
    });
  }

  private paint() {
    const canvas = this.texture.image as HTMLCanvasElement;
    const context = canvas.getContext('2d')!;
    const scale = canvas.width / 360;
    context.fillStyle = '#172d3b';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#304956';
    context.lineWidth = 1;
    context.beginPath();
    for (let longitude = -180; longitude <= 180; longitude += 30) {
      const x = (longitude + 180) * scale;
      context.moveTo(x, 0); context.lineTo(x, canvas.height);
    }
    for (let latitude = -60; latitude <= 60; latitude += 30) {
      const y = (90 - latitude) * scale;
      context.moveTo(0, y); context.lineTo(canvas.width, y);
    }
    context.stroke();
    for (const country of countries) {
      const highlighted = country === this.highlighted;
      context.fillStyle = highlighted ? '#a2c472' : '#334c57';
      context.strokeStyle = highlighted ? '#e3f5b1' : '#63777f';
      context.lineWidth = highlighted ? 3 : 1.5;
      const polygons = country.geometry.type === 'Polygon' ? [country.geometry.coordinates] : country.geometry.coordinates;
      for (const polygon of polygons) {
        context.beginPath();
        for (const ring of polygon) {
          ring.forEach(([longitude, latitude], index) => {
            const x = (longitude + 180) * scale;
            const y = (90 - latitude) * scale;
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          });
          context.closePath();
        }
        context.fill('evenodd');
        context.stroke();
      }
    }
    this.texture.needsUpdate = true;
  }

  private render = () => {
    if (this.active && !this.disposed) this.renderer.render(this.scene, this.camera);
  };

  private resize() {
    if (!this.active || this.disposed) return;
    const { width, height } = this.container.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  setVisible(visible: boolean) {
    this.active = visible;
    this.controls.enabled = visible;
    if (visible) this.resize();
  }

  setSelection(point: Point | null, correct = true) {
    this.pin.visible = !!point;
    if (point) this.pin.position.copy(position(point, 1.006));
    this.pin.material.color.set(correct ? '#d6ef87' : '#ea947b');
    this.render();
  }

  showAnswer(country?: Country, answer?: Answer) {
    if (country !== this.highlighted) {
      this.highlighted = country;
      this.paint();
      if (country) {
        const polygons = country.geometry.type === 'Polygon' ? [country.geometry.coordinates] : country.geometry.coordinates;
        const primary = polygons.reduce((largest, polygon) => polygonArea(polygon) > polygonArea(largest) ? polygon : largest);
        const center = new THREE.Vector3();
        for (const [longitude, latitude] of primary[0]) center.add(position({ longitude, latitude }));
        this.camera.position.copy(center.normalize().multiplyScalar(3));
        this.controls.update();
      }
    }
    this.setSelection(answer ?? null, answer?.correct);
  }

  zoom(factor: number) {
    this.camera.position.setLength(THREE.MathUtils.clamp(this.camera.position.length() * factor, this.controls.minDistance, this.controls.maxDistance));
    this.controls.update();
    this.render();
  }

  reset() {
    this.camera.position.copy(position({ longitude: 0, latitude: 15 }, 3));
    this.controls.update();
    this.render();
  }

  dispose() {
    this.disposed = true;
    this.observer.disconnect();
    this.controls.dispose();
    this.surface.geometry.dispose();
    this.surface.material.dispose();
    this.pin.geometry.dispose();
    this.pin.material.dispose();
    this.texture.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
