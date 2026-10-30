# Swamp Fox Labs RF Toolkit

Practical RF calculators for planning radio links in the field: antenna lengths, free-space path loss, coax loss, and more.

**Use it:** <https://swfx2324.github.io/swamp-fox-labs-rf-toolkit/>

It runs entirely in the browser. Once a page has loaded, it keeps working offline, and you can install it to a phone or desktop from the browser menu.

## Calculators

| Calculator | Status | What it does |
| --- | --- | --- |
| Link Budget | Available | A full point-to-point link: TX power, coax loss and antenna gain to EIRP, free-space path loss, then RX antenna and coax to the received signal, link margin and max range. Antenna heights set the radio horizon, which caps max range, and a midpoint Fresnel zone clearance check. Drop TX and RX pins on a map for a real terrain profile: line of sight and Fresnel zone clearance along the whole path, with terrain diffraction loss (ITU-R P.526-16 Bullington method) added to the budget. Save paths by name to use them offline. Warns when used on HF, where free-space math doesn't apply. Coax loss covers LMR-100A to LMR-1700 plus typical RG-58, RG-8X and RG-213. |
| Antenna Length | Available | Cut lengths in feet-and-inches and metric for a half-wave dipole, end-fed half-wave, quarter-wave ground plane, 5/8-wave vertical, full-wave loop, J-pole and coax quarter-wave stubs, with band presets, an adjustable shortening factor and feed-point notes. |
| Sat Pointing | Available | Azimuth (true and compass), elevation and linear polarization skew from your location to a geostationary orbital slot, with reflector tilt for offset dishes, slant range and delay, and a bearing line on the map. Compass azimuth uses the built-in World Magnetic Model (WMM2025), so it works offline. |
| Coax Loss | Available | Loss, power delivered and SWR at the radio for a coax run, including the extra loss a high SWR causes, with every cable compared side by side for the same frequency and length. |

LMR coax figures use the k1/k2 coefficients published in the Times Microwave Communications Coax Selection Guide. The RG figures are fits to typical values from the same guide and vary by manufacturer.

## Development

Requires Node.js 24 or later.

```bash
npm install
npm run dev      # local dev server
npm test         # unit tests for the math in src/lib
npm run build    # type-check and build to dist/
```

The formulas live in `src/lib` as plain functions with no UI code, each with tests against reference values. Each calculator page lives in `src/calculators`. Pushing to `main` runs the tests and deploys to GitHub Pages.

## License

[MIT](LICENSE) © Swamp Fox Labs

## Data and credits

- Terrain elevation: [Copernicus DEM GLO-90](https://doi.org/10.5270/ESA-c5d3d65) (© DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA), served by the [Open-Meteo Elevation API](https://open-meteo.com/en/docs/elevation-api).
- Magnetic declination: [World Magnetic Model WMM2025](https://www.ncei.noaa.gov/products/world-magnetic-model) by NOAA NCEI and the British Geological Survey, a U.S. Government work not subject to copyright. The implementation is tested against NOAA's 100 official WMM2025 test values.
- Map tiles: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, drawn with [Leaflet](https://leafletjs.com/).
