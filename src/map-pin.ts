import L from 'leaflet';

export type MapProjection = { zoom: number; origin: L.Point };

// A marker translates in its own pane; unlike CircleMarker, its circle is never
// scaled with the geography renderer during a zoom.
export class MapPin extends L.Marker {
  private frame = 0;
  private projection?: MapProjection;

  constructor(private map: L.Map, point: L.LatLngExpression, correct?: boolean, projection?: MapProjection) {
    super(point, {
      icon: L.divIcon({ className: 'map-selection-pin', iconSize: [17, 17], iconAnchor: [8.5, 8.5] }),
      interactive: false, keyboard: false, zIndexOffset: 1000,
    });
    this.addTo(map);
    this.on('remove', this.stopTracking);
    this.place(point, correct, projection);
  }

  place(point: L.LatLngExpression, correct?: boolean, projection?: MapProjection): void {
    this.stopTracking();
    this.setLatLng(point);
    this.getElement()!.style.backgroundColor = correct === false ? '#ea947b' : '#d6ef87';
    if (!projection) return;
    // A pin created or moved after zoomanim missed the native CSS transition.
    // Follow the rendered geography until zoomend, not Leaflet's early target.
    this.projection = projection;
    this.getElement()!.classList.add('is-tracking-zoom');
    this.map.once('zoomend', this.finishTracking);
    this.track();
  }

  private track = (): void => {
    if (!this.projection) return;
    const matrix = this.map.getContainer().querySelector<SVGGElement>('.leaflet-overlay-pane > svg > g')?.getScreenCTM();
    const icon = this.getElement();
    if (!matrix || !icon) return;
    const point = this.map.project(this.getLatLng(), this.projection.zoom).subtract(this.projection.origin);
    const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    const pane = this.map.getPane('markerPane')!.getBoundingClientRect();
    L.DomUtil.setPosition(icon, L.point(screen.x - pane.left, screen.y - pane.top));
    this.frame = requestAnimationFrame(this.track);
  };

  private stopTracking = (): void => {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.projection = undefined;
    this.map.off('zoomend', this.finishTracking);
    this.getElement()?.classList.remove('is-tracking-zoom');
  };

  private finishTracking = (): void => {
    this.stopTracking();
    this.setLatLng(this.getLatLng());
  };
}
