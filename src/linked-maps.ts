import L from 'leaflet';
import type { Polygon } from 'geojson';
import { countries, polygonArea, type Country } from './geography';
import { MapPin, type MapProjection } from './map-pin';
import { GeographyRenderer } from './geography-renderer';

type Answer = { longitude: number; latitude: number; correct: boolean };
type LandMass = { country: Country; geometry: Polygon; bounds: L.LatLngBounds; area: number; anchor?: L.LatLng };
type Frame = { primary: LandMass; region: L.LatLngBounds; detail: L.LatLngBounds };
type Copies = Map<LandMass, Map<number, L.GeoJSON>>;
type Label = { part: LandMass; anchor: L.LatLng; marker: L.Marker; span: HTMLSpanElement; width: number; visible: boolean };
type Labels = Map<string, Label>;
// Simplifying again at each zoom changes the coastline after the CSS animation.
const boundaryStyle: L.PolylineOptions = { smoothFactor: 0, color: '#63777f', weight: 0.8, fillColor: '#334c57', fillOpacity: 1, interactive: false };
const targetStyle: L.PolylineOptions = { smoothFactor: 0, color: '#e3f5b1', weight: 2, fillColor: '#a2c472', fillOpacity: 0.85, interactive: false, className: 'linked-target' };
const frames = new Map<string, Frame>();
let landMasses: LandMass[] | undefined;

function geography(): LandMass[] {
  // Keep the source rings, not a second copy of the entire geography. Natural
  // Earth's polygons are already split at the antimeridian.
  return landMasses ??= countries.flatMap(country => {
    const polygons = country.geometry.type === 'Polygon' ? [country.geometry.coordinates] : country.geometry.coordinates;
    return polygons.map(coordinates => {
      const bounds = L.latLngBounds([]);
      const exterior = coordinates[0];
      for (let i = 1; i < exterior.length; i++) {
        const [x, y] = exterior[i];
        bounds.extend([y, x]);
      }
      const area = polygonArea(coordinates);
      return { country, geometry: { type: 'Polygon' as const, coordinates }, bounds, area };
    });
  });
}

function shiftFor(part: LandMass, longitude: number): number {
  return 360 * Math.round((longitude - part.bounds.getCenter().lng) / 360);
}

function intersects(part: LandMass, shift: number, bounds: L.LatLngBounds): boolean {
  return part.bounds.getWest() + shift <= bounds.getEast() && part.bounds.getEast() + shift >= bounds.getWest()
    && part.bounds.getSouth() <= bounds.getNorth() && part.bounds.getNorth() >= bounds.getSouth();
}

// A bounding-box centre can be in the ocean (or a lake). Intersect horizontal
// scanlines with every ring, including holes, and use a filled interval instead.
function landPoint(part: LandMass, bounds = part.bounds): L.LatLng | undefined {
  const south = Math.max(bounds.getSouth(), part.bounds.getSouth());
  const north = Math.min(bounds.getNorth(), part.bounds.getNorth());
  const west = Math.max(bounds.getWest(), part.bounds.getWest());
  const east = Math.min(bounds.getEast(), part.bounds.getEast());
  if (south >= north || west >= east) return;
  let widest = 0;
  let point: L.LatLng | undefined;
  for (const fraction of [0.5, 0.25, 0.75, 0.125, 0.875]) {
    const latitude = south + (north - south) * fraction;
    const crossings: number[] = [];
    for (const ring of part.geometry.coordinates) {
      for (let i = 1; i < ring.length; i++) {
        const [x1, y1] = ring[i - 1];
        const [x2, y2] = ring[i];
        if ((y1 > latitude) !== (y2 > latitude)) crossings.push(x1 + (latitude - y1) * (x2 - x1) / (y2 - y1));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const left = Math.max(west, crossings[i]);
      const right = Math.min(east, crossings[i + 1]);
      if (right - left > widest) {
        widest = right - left;
        point = L.latLng(latitude, (left + right) / 2);
      }
    }
  }
  return point;
}

function frameFor(country: Country): Frame {
  const cached = frames.get(country.properties.id);
  if (cached) return cached;
  const parts = geography();
  const primary = parts.filter(part => part.country.properties.id === country.properties.id).reduce((largest, part) => part.area > largest.area ? part : largest);
  const center = primary.bounds.getCenter();
  const diameter = primary.bounds.getSouthWest().distanceTo(primary.bounds.getNorthEast());
  const region = center.toBounds(Math.max(700_000, diameter * 2.2)).extend(primary.bounds);
  if (diameter < 1_200_000) {
    // Small islands need a regional reference, not just more empty ocean. Use
    // nearby larger components, never a country's distant territory or centroid.
    const candidates = parts.filter(part => part.country.properties.id !== country.properties.id && part.area >= primary.area * 4).map(part => {
      const shift = shiftFor(part, center.lng);
      const nearest = L.latLng(
        Math.max(part.bounds.getSouth(), Math.min(part.bounds.getNorth(), center.lat)),
        Math.max(part.bounds.getWest() + shift, Math.min(part.bounds.getEast() + shift, center.lng)),
      );
      return { part, shift, distance: center.distanceTo(nearest) };
    }).sort((a, b) => a.distance - b.distance).slice(0, 12).map(candidate => {
      let distance = Infinity;
      let point = center;
      for (const coordinate of candidate.part.geometry.coordinates[0]) {
        const vertex = L.latLng(coordinate[1], coordinate[0] + candidate.shift);
        const nextDistance = center.distanceTo(vertex);
        if (nextDistance < distance) { distance = nextDistance; point = vertex; }
      }
      return { ...candidate, distance, point };
    }).sort((a, b) => a.distance - b.distance);
    const neighbors = new Set<string>();
    for (const candidate of candidates) {
      if (candidate.distance > 2_500_000 || neighbors.has(candidate.part.country.properties.id)) continue;
      region.extend(candidate.point);
      neighbors.add(candidate.part.country.properties.id);
      if (neighbors.size === 2) break;
    }
  }
  const padded = region.pad(0.2);
  const anchor = primary.anchor ??= landPoint(primary);
  // A continent-wide polygon cannot be a useful close-up in a narrow pane.
  const detail = diameter > 3_000_000 && anchor ? anchor.toBounds(1_500_000) : primary.bounds.pad(0.35);
  const frame = { primary, detail, region: L.latLngBounds(
    [Math.max(-85, padded.getSouth()), Math.max(center.lng - 180, padded.getWest())],
    [Math.min(85, padded.getNorth()), Math.min(center.lng + 180, padded.getEast())],
  ) };
  frames.set(country.properties.id, frame);
  return frame;
}

export class LinkedMaps {
  private detail?: L.Map;
  private country?: Country;
  private frame?: Frame;
  private active = false;
  private answered = false;
  private hideTargetName = false;
  private selectable = true;
  private needsRecenter = false;
  private animateRecenter = false;
  private resizing = false;
  private resizeFrame = 0;
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private zoomTarget?: number;
  private viewportFrame = 0;
  private coverageFrame = 0;
  private coverage = new Map<L.Map, L.LatLngBounds>();
  private zoomProjections = new Map<L.Map, MapProjection>();
  private originalZoomSnap?: number;
  private overviewTarget?: L.GeoJSON;
  private detailTarget?: L.GeoJSON;
  private viewport?: L.SVGOverlay;
  private pin?: MapPin;
  private overviewLabels: Labels = new Map();
  private detailLabels: Labels = new Map();
  private overviewCopies: Copies = new Map();
  private detailCopies: Copies = new Map();
  private overviewScale = L.control.scale({ imperial: false, position: 'bottomleft' });
  private observer: ResizeObserver;

  constructor(private overview: L.Map, private detailContainer: HTMLElement, private onSelect: (point: L.LatLng) => void) {
    this.observer = new ResizeObserver(() => {
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = requestAnimationFrame(() => this.resize());
    });
    this.reducedMotion.addEventListener('change', () => {
      if (this.detail) this.detail.options.inertia = !this.reducedMotion.matches;
      if (this.active && this.reducedMotion.matches) this.stopMovement();
    });
  }

  show(country: Country, answer?: Answer, options: { hideTargetName?: boolean; selectable?: boolean } = {}): void {
    const changed = this.country?.properties.id !== country.properties.id;
    this.needsRecenter ||= !this.active || changed || !!answer;
    this.animateRecenter = this.active && (changed || !!answer);
    if (!this.active) {
      this.stopMovement();
      this.originalZoomSnap = this.overview.options.zoomSnap;
      this.overview.options.zoomSnap = 0.25;
      this.overview.on('click', this.navigate);
      this.overview.on('move', this.scheduleCoverage);
      this.overview.on('moveend', this.refreshOverview);
      this.overview.on('zoomanim', this.startZoom);
      this.overview.on('zoomend', this.endZoom);
      this.overviewScale.addTo(this.overview);
      this.observer.observe(this.overview.getContainer());
      this.observer.observe(this.detailContainer);
    }
    this.active = true;
    this.country = country;
    this.frame = frameFor(country);
    this.answered = !!answer;
    this.hideTargetName = options.hideTargetName ?? false;
    this.selectable = options.selectable ?? true;
    if (this.hideTargetName) {
      for (const labels of [this.overviewLabels, this.detailLabels]) {
        labels.get(country.properties.id)?.marker.remove();
        labels.delete(country.properties.id);
      }
    }
    if (!this.detail) {
      this.detail = L.map(this.detailContainer, {
        minZoom: 1, maxZoom: 16, zoomSnap: 0.25, zoomControl: false,
        zoomAnimation: !this.reducedMotion.matches, fadeAnimation: false, markerZoomAnimation: !this.reducedMotion.matches,
        doubleClickZoom: false, inertia: !this.reducedMotion.matches, inertiaMaxSpeed: 900, inertiaDeceleration: 16000,
        renderer: new GeographyRenderer({ padding: 0.5 }),
      });
      L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(this.detail);
      this.detail.attributionControl.addAttribution('Natural Earth · Public domain');
      L.geoJSON(countries, { style: boundaryStyle, interactive: false }).addTo(this.detail);
      this.detail.on('click', this.select);
      this.detail.on('move zoom', this.syncViewport);
      this.detail.on('move', this.scheduleCoverage);
      this.detail.on('moveend', this.refreshDetail);
      this.detail.on('zoomanim', this.startZoom);
      this.detail.on('zoomend', this.endZoom);
      this.detail.on('zoomend', () => {
        if (this.zoomTarget !== undefined && this.detail!.getZoom() !== this.zoomTarget) {
          this.detail!.setZoom(this.zoomTarget, { animate: !this.reducedMotion.matches });
        } else this.zoomTarget = undefined;
      });
      this.detail.on('dragstart', () => { this.zoomTarget = undefined; });
      for (const event of ['pointerdown', 'wheel', 'keydown']) {
        this.detailContainer.addEventListener(event, () => {
          this.zoomTarget = undefined;
          if (event === 'keydown') this.stopMovement();
        }, { passive: true });
      }
    }
    if (changed || !this.overviewTarget) {
      this.overviewTarget?.remove();
      this.detailTarget?.remove();
      this.overviewTarget = L.geoJSON(country, { style: targetStyle, interactive: false }).addTo(this.overview);
      this.detailTarget = L.geoJSON(country, { style: targetStyle, interactive: false }).addTo(this.detail);
      this.clearCopies(this.overviewCopies);
      this.clearCopies(this.detailCopies);
    }
    this.pin?.remove();
    this.pin = undefined;
    this.resize();
    if (answer) this.placePin(L.latLng(answer.latitude, answer.longitude), answer.correct);
  }

  hide(): void {
    if (!this.active) return;
    this.active = false;
    this.stopMovement();
    this.needsRecenter = false;
    this.animateRecenter = false;
    this.observer.disconnect();
    cancelAnimationFrame(this.resizeFrame);
    this.overview.off('click', this.navigate);
    this.overview.off('moveend', this.refreshOverview);
    this.overview.off('move', this.scheduleCoverage);
    this.overview.off('zoomanim', this.startZoom);
    this.overview.off('zoomend', this.endZoom);
    this.overviewTarget?.remove();
    this.overviewTarget = undefined;
    this.detailTarget?.remove();
    this.detailTarget = undefined;
    this.viewport?.remove();
    this.viewport = undefined;
    this.pin?.remove();
    this.pin = undefined;
    this.clearLabels(this.overviewLabels);
    this.clearLabels(this.detailLabels);
    this.clearCopies(this.overviewCopies);
    this.clearCopies(this.detailCopies);
    this.overviewScale.remove();
    this.overview.options.zoomSnap = this.originalZoomSnap;
  }

  recenter(): void {
    if (!this.active) return;
    this.needsRecenter = true;
    this.animateRecenter = true;
    this.resize();
  }

  zoomBy(levels: 1 | -1): void {
    if (!this.active || !this.detail) return;
    const zoom = Math.max(this.detail.getMinZoom(), Math.min(this.detail.getMaxZoom(), (this.zoomTarget ?? Math.round(this.detail.getZoom() * 4) / 4) + levels));
    this.zoomTarget = zoom;
    if (!this.detailContainer.querySelector('.leaflet-zoom-anim')) {
      this.detail.setZoom(zoom, { animate: !this.reducedMotion.matches });
    }
  }

  private stopMovement(): void {
    this.zoomTarget = undefined;
    cancelAnimationFrame(this.viewportFrame);
    cancelAnimationFrame(this.coverageFrame);
    this.coverageFrame = 0;
    this.coverage.clear();
    this.zoomProjections.clear();
    for (const map of [this.overview, this.detail]) {
      if (!map || map.getZoom() === undefined) continue;
      // Public stop() does not finish Leaflet's CSS zoom; settle it before
      // replacing the view so its delayed callback cannot restore a stale target.
      if (map.getContainer().querySelector('.leaflet-zoom-anim')) {
        (map as L.Map & { _onZoomTransitionEnd(): void })._onZoomTransitionEnd();
      }
      const zoomSnap = map.options.zoomSnap;
      map.options.zoomSnap = 0;
      map.setView(map.getCenter(), map.getZoom(), { animate: false });
      map.options.zoomSnap = zoomSnap;
    }
  }

  private resize(): void {
    if (!this.active || !this.detail || !this.frame || this.resizing) return;
    const overviewContainer = this.overview.getContainer();
    if (!overviewContainer.clientWidth || !overviewContainer.clientHeight || !this.detailContainer.clientWidth || !this.detailContainer.clientHeight) return;
    this.resizing = true;
    for (const map of [this.overview, this.detail]) {
      const container = map.getContainer();
      const size = map.getSize();
      if (size.x === container.clientWidth && size.y === container.clientHeight) continue;
      if (container.querySelector('.leaflet-zoom-anim')) this.stopMovement();
      // Native size invalidation preserves the center without setView(), which
      // would cancel a country flight for a transient panel/layout resize.
      map.invalidateSize({ pan: true, animate: false });
    }
    if (this.needsRecenter) {
      this.needsRecenter = false;
      this.stopMovement();
      const animate = this.animateRecenter && !this.reducedMotion.matches;
      this.animateRecenter = false;
      this.overview.flyToBounds(this.frame.region, { padding: [28, 28], maxZoom: 7, animate });
      this.detail.flyToBounds(this.frame.detail, { padding: [28, 28], maxZoom: 14, animate });
    }
    this.resizing = false;
    this.syncViewport();
    this.refreshOverview();
    this.refreshDetail();
  }

  private navigate = (event: L.LeafletMouseEvent): void => {
    if (!this.active || !this.detail) return;
    const point = this.visiblePoint(this.overview, event.containerPoint);
    if (Math.abs(point.lat) <= 85) {
      this.zoomTarget = undefined;
      if (this.detailContainer.querySelector('.leaflet-zoom-anim')) this.stopMovement();
      this.detail.flyTo(point, this.detail.getZoom(), { animate: !this.reducedMotion.matches });
    }
  };

  private select = (event: L.LeafletMouseEvent): void => {
    if (!this.active || this.answered || !this.selectable || !this.detail) return;
    const visible = this.visiblePoint(this.detail, event.containerPoint);
    if (Math.abs(visible.lat) > 85) return;
    const point = visible.wrap();
    this.placePin(point);
    this.onSelect(point);
  };

  private placePin(point: L.LatLng, correct?: boolean): void {
    if (!this.detail || !this.frame) return;
    const longitude = this.detail.getZoom() === undefined ? this.frame.primary.bounds.getCenter().lng : this.detail.getCenter().lng;
    const displayed = L.latLng(point.lat, point.lng + 360 * Math.round((longitude - point.lng) / 360));
    const projection = this.zoomProjections.get(this.detail);
    if (this.pin) this.pin.place(displayed, correct, projection);
    else this.pin = new MapPin(this.detail, displayed, correct, projection);
  }

  private startZoom = (event: L.ZoomAnimEvent): void => {
    if (!this.active) return;
    const map = event.target as L.Map;
    // Zoom-out needs the destination's wrapped land before the animation ends.
    const half = map.getSize().divideBy(2);
    const center = map.project(event.center, event.zoom);
    const destination = L.latLngBounds(map.unproject(center.subtract(half), event.zoom), map.unproject(center.add(half), event.zoom));
    this.refreshCopies(map, map === this.overview ? this.overviewCopies : this.detailCopies, destination.extend(map.getBounds()));
    if (!this.zoomProjections.has(map)) {
      this.zoomProjections.set(map, { zoom: map.getZoom(), origin: map.getPixelOrigin() });
    }
    if (map === this.detail) {
      cancelAnimationFrame(this.viewportFrame);
      this.viewportFrame = requestAnimationFrame(this.trackViewport);
    }
  };

  private endZoom = (event: L.LeafletEvent): void => {
    this.zoomProjections.delete(event.target as L.Map);
    if (event.target === this.detail) cancelAnimationFrame(this.viewportFrame);
    this.syncViewport();
  };

  private trackViewport = (): void => {
    if (!this.active || !this.detail || !this.zoomProjections.has(this.detail)) return;
    this.syncViewport();
    this.viewportFrame = requestAnimationFrame(this.trackViewport);
  };

  private visiblePoint(map: L.Map, point: L.Point): L.LatLng {
    const projection = this.zoomProjections.get(map);
    const matrix = projection && map.getContainer().querySelector<SVGGElement>('.leaflet-overlay-pane > svg > g')?.getScreenCTM();
    if (!projection || !matrix) return map.containerPointToLatLng(point);
    // CSS zoom updates Leaflet's target projection before the geometry arrives.
    const rect = map.getContainer().getBoundingClientRect();
    const pixel = new DOMPoint(rect.left + map.getContainer().clientLeft + point.x, rect.top + map.getContainer().clientTop + point.y).matrixTransform(matrix.inverse());
    return map.unproject(L.point(pixel.x, pixel.y).add(projection.origin), projection.zoom);
  }

  private syncViewport = (): void => {
    if (!this.active || this.resizing || !this.detail || this.detail.getZoom() === undefined) return;
    const bounds = L.latLngBounds(this.visiblePoint(this.detail, L.point(0, 0)), this.visiblePoint(this.detail, this.detail.getSize()));
    if (this.viewport) this.viewport.setBounds(bounds);
    else {
      // An independent native overlay can change bounds while the overview's
      // polygon renderer is still scaling its previous projection.
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 100 100');
      svg.setAttribute('preserveAspectRatio', 'none');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M0 0H100V100H0Z');
      path.setAttribute('class', 'linked-viewport');
      svg.append(path);
      this.viewport = L.svgOverlay(svg, bounds, { interactive: false }).addTo(this.overview);
    }
    this.viewport.bringToFront();
  };
  private scheduleCoverage = (): void => {
    if (!this.active || this.resizing || this.coverageFrame) return;
    this.coverageFrame = requestAnimationFrame(() => {
      this.coverageFrame = 0;
      if (!this.active) return;
      this.refreshCopies(this.overview, this.overviewCopies);
      if (this.detail) this.refreshCopies(this.detail, this.detailCopies);
    });
  };


  private refreshOverview = (): void => {
    if (!this.active || this.resizing) return;
    this.refreshMap(this.overview, this.overviewLabels, this.overviewCopies);
    this.viewport?.bringToFront();
  };

  private refreshDetail = (): void => {
    if (!this.active || this.resizing || !this.detail || this.detail.getZoom() === undefined) return;
    this.refreshMap(this.detail, this.detailLabels, this.detailCopies);
    this.syncViewport();
  };

  private clearCopies(copies: Copies): void {
    for (const shifts of copies.values()) for (const layer of shifts.values()) layer.remove();
    copies.clear();
    this.coverage.clear();
  }

  private clearLabels(labels: Labels): void {
    for (const label of labels.values()) label.marker.remove();
    labels.clear();
  }

  private refreshCopies(map: L.Map, copies: Copies, view = map.getBounds()): void {
    const previous = this.coverage.get(map);
    // Reuse the buffer during small moves instead of scanning all land per frame.
    if (previous?.contains(view)) return;
    const bounds = view.pad(0.5);
    const retained = view.pad(0.75);
    this.coverage.set(map, bounds.pad(-0.2));
    for (const [part, shifts] of copies) {
      for (const [shift, layer] of shifts) {
        if (!intersects(part, shift, retained)) {
          layer.remove();
          shifts.delete(shift);
        }
      }
      if (!shifts.size) copies.delete(part);
    }
    for (const part of geography()) {
      if (part.bounds.getSouth() > bounds.getNorth() || part.bounds.getNorth() < bounds.getSouth()) continue;
      const first = Math.ceil((bounds.getWest() - part.bounds.getEast()) / 360);
      const last = Math.floor((bounds.getEast() - part.bounds.getWest()) / 360);
      for (let world = first; world <= last; world++) {
        if (!world) continue; // The base dataset already supplies the original world.
        const shift = world * 360;
        let shifts = copies.get(part);
        if (shifts?.has(shift)) continue;
        const layer = L.geoJSON(part.geometry, {
          coordsToLatLng: coordinate => L.latLng(coordinate[1], coordinate[0] + shift),
          style: part.country.properties.id === this.country?.properties.id ? targetStyle : boundaryStyle, interactive: false,
        }).addTo(map);
        if (!shifts) copies.set(part, shifts = new Map());
        shifts.set(shift, layer);
      }
    }
  }

  private refreshMap(map: L.Map, labels: Labels, copies: Copies): void {
    this.refreshCopies(map, copies);
    const bounds = map.getBounds();
    const longitude = map.getCenter().lng;
    const candidates = new Map<string, { part: LandMass; shift: number }>();
    for (const part of geography()) {
      const shift = shiftFor(part, longitude);
      if (!intersects(part, shift, bounds)) continue;
      const id = part.country.properties.id;
      if (this.hideTargetName && id === this.country?.properties.id) continue;
      const previous = candidates.get(id);
      const existing = labels.get(id);
      // Keep the same island/territory while it is still in view.
      if (!previous || part === existing?.part || (previous.part !== existing?.part && part.area > previous.part.area)) {
        candidates.set(id, { part, shift });
      }
    }
    const occupied: { x: number; y: number; width: number }[] = [];
    const size = map.getSize();
    const targetId = this.country?.properties.id;
    const ranked = [...candidates.values()].sort((a, b) =>
      Number(b.part.country.properties.id === targetId) - Number(a.part.country.properties.id === targetId)
      || Number(labels.get(b.part.country.properties.id)?.visible ?? false) - Number(labels.get(a.part.country.properties.id)?.visible ?? false)
      || b.part.area - a.part.area);
    const shown = new Set<string>();
    for (const { part, shift } of ranked) {
      const id = part.country.properties.id;
      let label = labels.get(id);
      if (!label || label.part !== part) {
        part.anchor ??= landPoint(part);
        const visible = L.latLngBounds([bounds.getSouth(), bounds.getWest() - shift], [bounds.getNorth(), bounds.getEast() - shift]);
        const anchor = part.anchor && visible.contains(part.anchor) ? part.anchor : landPoint(part, visible);
        if (!anchor) continue;
        if (label) {
          label.part = part;
          label.anchor = anchor;
        } else {
          const span = document.createElement('span');
          span.textContent = part.country.properties.name;
          const marker = L.marker([anchor.lat, anchor.lng + shift], {
            icon: L.divIcon({ className: 'linked-country-label', html: span, iconSize: [0, 0], iconAnchor: [0, 0] }),
            interactive: false, keyboard: false,
          }).addTo(map);
          label = { part, anchor, marker, span, width: Math.min(115, span.textContent.length * 6 + 12), visible: false };
          labels.set(id, label);
        }
      }
      // The anchor belongs to the label, not to the current clipped viewport.
      const position = L.latLng(label.anchor.lat, label.anchor.lng + shift);
      if (!label.marker.getLatLng().equals(position)) label.marker.setLatLng(position);
      const pixel = map.latLngToContainerPoint(position);
      const { width } = label;
      const margin = label.visible ? 0 : 8;
      if (pixel.x < width / 2 + margin || pixel.y < 10 + margin || pixel.x > size.x - width / 2 - margin || pixel.y > size.y - 10 - margin
        || occupied.some(other => Math.abs(other.x - pixel.x) < (other.width + width) / 2 + margin && Math.abs(other.y - pixel.y) < 25 + margin)) continue;
      shown.add(id);
      occupied.push({ x: pixel.x, y: pixel.y, width });
      if (occupied.length === 9) break;
    }
    for (const [id, label] of labels) {
      const visible = shown.has(id);
      if (label.visible === visible) continue;
      label.visible = visible;
      label.span.classList.toggle('is-visible', visible);
      label.span.setAttribute('aria-hidden', String(!visible));
    }
  }
}
