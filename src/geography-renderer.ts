import L from 'leaflet';

type LatLngs = L.LatLng[] | LatLngs[];

// Leaflet 1.9's renderer hooks are not exposed by @types/leaflet. Keep that
// boundary here; the rest of the application only constructs an SVG renderer.
type ProjectedPolygon = L.Polyline & {
  _rings: L.Point[][];
  _rawPxBounds?: L.Bounds;
  _project(): void;
  _update(): void;
  _updateBounds(): void;
};
const svg = L.SVG.prototype as L.SVG & {
  _update(): void;
  _onZoom(): void;
  _onAnimZoom(event: L.ZoomAnimEvent): void;
  _updatePaths(): void;
  _addPath(layer: ProjectedPolygon): void;
  _updateStyle(layer: L.Polyline): void;
};

// Geography uses polylines/polygons. Pins and the linked viewport remain
// independent overlays so they keep their own screen-space animation behavior.
export class GeographyRenderer extends L.SVG {
  declare private _bounds: L.Bounds;
  declare private _zoom: number;
  declare private _container: SVGSVGElement;
  private origin?: L.Point;
  private strokeFrame = 0;

  getEvents(): Record<string, L.LeafletEventHandlerFn> {
    return { ...svg.getEvents!.call(this), move: this.coverView };
  }

  _update(): void {
    if ((this._map as L.Map & { _animatingZoom?: boolean })._animatingZoom && this._bounds) return;
    this.origin = this._map.getPixelOrigin();
    svg._update.call(this);
    cancelAnimationFrame(this.strokeFrame);
    this._container.style.setProperty('--geography-stroke-scale', '1');
    // The map container still clips at its edges. The SVG's *old* viewport must
    // not cut off the additional geometry exposed by an animated transform.
    this._container.style.overflow = 'visible';
  }

  _onAnimZoom(event: L.ZoomAnimEvent): void {
    this.cover(event.center, event.zoom, true);
    svg._onAnimZoom.call(this, event);
    cancelAnimationFrame(this.strokeFrame);
    this.trackStroke();
  }

  _onZoom(): void {
    this.coverView();
    svg._onZoom.call(this);
    this._container.style.setProperty('--geography-stroke-scale', String(1 / this._map.getZoomScale(this._map.getZoom(), this._zoom)));
  }

  private coverView = (): void => {
    if ((this._map as L.Map & { _animatingZoom?: boolean })._animatingZoom) return;
    this.cover(this._map.getCenter(), this._map.getZoom(), false);
  };

  private trackStroke = (): void => {
    // CSS zooms transform the outer SVG viewport. vector-effect cannot undo
    // that scale; compensate using the visible, interpolated transform.
    const matrix = this._container.getScreenCTM();
    if (matrix) this._container.style.setProperty('--geography-stroke-scale', String(1 / Math.hypot(matrix.a, matrix.b)));
    this.strokeFrame = requestAnimationFrame(this.trackStroke);
  };

  _updateStyle(layer: L.Polyline): void {
    svg._updateStyle.call(this, layer);
    const path = layer.getElement() as SVGPathElement;
    path.style.setProperty('--geography-stroke-width', `${layer.options.weight}px`);
  }

  onRemove(map: L.Map): this {
    cancelAnimationFrame(this.strokeFrame);
    super.onRemove(map);
    return this;
  }

  private cover(center: L.LatLng, zoom: number, retain: boolean): void {
    if (!this.origin) return;
    // Work in the existing paths' projection, not Leaflet's early zoom target.
    const scale = this._map.getZoomScale(zoom, this._zoom);
    const half = this._map.getSize().divideBy(2 * scale);
    const point = this._map.project(center, this._zoom).subtract(this.origin);
    const visible = L.bounds(point.subtract(half), point.add(half));
    if (this._bounds.contains(visible)) return;
    const padded = half.multiplyBy(1 + 2 * (this.options.padding ?? 0.1));
    const bounds = L.bounds(point.subtract(padded), point.add(padded));
    // CSS interpolates between both views. Flights/pans only need a buffer
    // around the current view, otherwise a long flight accumulates the world.
    if (retain) bounds.extend(this._bounds.min!).extend(this._bounds.max!);
    this._bounds = bounds;
    svg._updatePaths.call(this);
  }

  _addPath(layer: ProjectedPolygon): void {
    if (this.align(layer)) layer._update();
    svg._addPath.call(this, layer);
  }

  _updatePath(layer: ProjectedPolygon): void {
    layer._project();
    this.align(layer);
    layer._update();
  }

  private align(layer: ProjectedPolygon): boolean {
    if (!this.origin) return false;
    const zoom = this._map.getZoom();
    const origin = this._map.getPixelOrigin();
    if (zoom === this._zoom && origin.equals(this.origin)) return false;
    // New/changed polygons must use the renderer's projection too. Transforming
    // Leaflet's already-rounded low-zoom pixels can collapse a small island to
    // a line for the rest of a flight. Reproject only this arriving geometry
    // from geographic coordinates, reusing its allocated rings.
    const base = this.origin;
    const raw = L.bounds([]);
    let ringIndex = 0;
    const project = (coordinates: LatLngs): void => {
      if (!coordinates.length) return;
      if (coordinates[0] instanceof L.LatLng) {
        const ring = layer._rings[ringIndex++];
        const points = coordinates as L.LatLng[];
        for (let i = 0; i < points.length; i++) {
          const point = this._map.project(points[i], this._zoom);
          point.x = Math.round(point.x) - base.x;
          point.y = Math.round(point.y) - base.y;
          ring[i] = point;
          raw.extend(point);
        }
      } else {
        for (const nested of coordinates as LatLngs[]) project(nested);
      }
    };
    project(layer.getLatLngs());
    layer._rawPxBounds = raw;
    layer._updateBounds();
    return true;
  }
}
