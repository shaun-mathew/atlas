import L from 'leaflet';
import { inlandWaters } from './geography';
import { GeographyRenderer } from './geography-renderer';

const renderers = new WeakMap<L.Map, GeographyRenderer>();
const paneName = 'inlandWater';
const waterStyle: L.PolylineOptions = {
  smoothFactor: 0, color: '#63777f', weight: 0.8, fillColor: '#111e29', fillOpacity: 1, interactive: false,
};

export function addInlandWater(map: L.Map, longitudeShift = 0): L.GeoJSON {
  let renderer = renderers.get(map);
  if (!renderer) {
    const pane = map.getPane(paneName) ?? map.createPane(paneName);
    // Land/highlights use overlayPane (400); pins and labels use markerPane (600).
    pane.style.zIndex = '450';
    pane.style.pointerEvents = 'none';
    renderer = new GeographyRenderer({ pane: paneName, padding: 0.5 });
    renderers.set(map, renderer);
  }
  return L.geoJSON(inlandWaters, {
    pane: paneName, interactive: false, style: { ...waterStyle, renderer },
    coordsToLatLng: coordinate => L.latLng(coordinate[1], coordinate[0] + longitudeShift),
  }).addTo(map);
}
