// Label-free ESA WorldCover Sentinel-2 RGB yearly median composite from 2021,
// approximately 10m per source pixel; not current imagery or street-level detail.
// CC BY 4.0, including the composites: https://esa-worldcover.org/en/data-access
// Native zoom/coverage: https://wmts.terrascope.be/?service=WMTS&request=GetCapabilities
export const cityImageryUrlTemplate = 'https://wmts.terrascope.be/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=esa-worldcover-s2rgbnir-10m-2021-v2_tcc&STYLE=default&TIME=2021-01-01&TILEMATRIXSET=EPSG:3857&TILEMATRIX={z}&TILECOL={x}&TILEROW={y}&FORMAT=image/png';
export const cityImageryMinZoom = 6;
export const cityImageryMaxZoom = 14;
export const cityImageryBounds: [[number, number], [number, number]] = [[-60, -180], [83, 180]];
export const cityImageryAttribution = '&copy; <a href="https://esa-worldcover.org/en/data-access">ESA WorldCover 2021 annual composite</a> · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a> · Contains modified Copernicus Sentinel data (2021), processed by ESA WorldCover consortium';

// NASA GIBS Blue Marble shaded relief/bathymetry is a label-free, historical
// overview. Keep it beneath Sentinel-2, including transparent coastal no-data.
// GIBS advertises native zooms 0–8; overview tiles only need zooms below detail.
// Open-data use and acknowledgement: https://nasa-gibs.github.io/gibs-api-docs/
export const cityOverviewUrlTemplate = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';
export const cityOverviewMaxZoom = cityImageryMinZoom - 1;
export const cityOverviewAttribution = 'Overview imagery provided by <a href="https://nasa-gibs.github.io/gibs-api-docs/">NASA GIBS / ESDIS · Blue Marble</a>';
