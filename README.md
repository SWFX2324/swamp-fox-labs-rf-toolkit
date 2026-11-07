<p align="center"><img src="assets/swamp-fox-labs-logo-dark.svg" width="420" alt="Swamp Fox Labs"></p>

# Swamp Fox Labs RF Toolkit

Practical RF calculators for planning radio links in the field: antenna lengths, free-space path loss, coax loss, and more.

**Use it:** <https://swfx2324.github.io/swamp-fox-labs-rf-toolkit/>

It runs entirely in the browser. Once a page has loaded, it keeps working offline, and you can install it to a phone or desktop from the browser menu. Before losing signal, use the download button on any map to save the terrain and satellite imagery for what's on screen. Street maps can't be saved this way, because OpenStreetMap's tile policy doesn't allow it.

## Calculators

| Calculator | Status | What it does |
| --- | --- | --- |
| Link Budget | Available | A full point-to-point link: TX power, coax loss and antenna gain to EIRP, free-space path loss, then RX antenna and coax to the received signal, link margin and max range. Antenna heights set the radio horizon, which caps max range, and a midpoint Fresnel zone clearance check. Drop TX and RX pins on a map for a real terrain profile: line of sight and Fresnel zone clearance along the whole path, with terrain loss from the Irregular Terrain Model (Longley-Rice) added to the budget, and how much of the time the link holds. An Earth curvature (k) setting checks clearance and the radio horizon at the standard 4/3, at 1, or at the 2/3 worst case microwave links are often planned for. Save paths by name to use them offline. Warns when used on HF, where free-space math doesn't apply. Coax loss covers LMR-100A to LMR-1700 plus typical RG-58, RG-8X and RG-213. |
| Mesh Planner | Available | Drop up to 10 nodes on a map and see every node-to-node link with the same radios over real terrain: margin, terrain loss and a solid / marginal / no-link rating, link lines on the map, and whether the mesh holds together or splits into groups, with the most hops between nodes. |
| Coverage Map | Available | Shades the area one site can reach on the map, out to 80 km: free-space loss plus Longley-Rice terrain loss along up to 240 radials, solid / marginal / strong areas, coverage percentages, the farthest solid point, and tap-to-read margin anywhere. Radio and antenna changes recalculate instantly, and mapped areas work offline. |
| Antenna Length | Available | Cut lengths in feet-and-inches and metric for a half-wave dipole, full-wave dipole, end-fed half-wave, quarter-wave ground plane, 5/8-wave vertical, full-wave loop, J-pole and coax quarter-wave stubs, with band presets, an adjustable shortening factor and feed-point notes. |
| Sat Pointing | Available | Azimuth (true and compass), elevation and linear polarization skew from your location to a geostationary orbital slot, with reflector tilt for offset dishes, slant range and delay, and a bearing line on the map. Compass azimuth uses the built-in World Magnetic Model (WMM2025), so it works offline. |
| Sat Link | Available | Uplink and downlink budget for a GEO terminal: dish gain and beamwidth, terminal EIRP and G/T, C/N0 each way and combined, and Es/N0 margin against any DVB-S2 modulation and FEC rate, with rain fade and its added sky noise. |
| Coax Loss | Available | Loss, power delivered and SWR at the radio for a coax run, including the extra loss a high SWR causes, with every cable compared side by side for the same frequency and length. |
| Power Plan | Available | List your gear with data plate watts, or volts and amps (AC or DC), and how many of each. Totals every line and the whole load, and recommends the smallest generator, from 5 to 60 kW, that carries it inside a planning limit, 80% by default. Save gear you use often to your equipment list and add it again with just a new quantity. Exports a CSV for Excel with every line and the total load. |
| RF Converter | Available | Linked converters for watts, dBm, dBW, microvolts and S-meter readings; SWR, return loss, reflection coefficient and mismatch loss; dBi and dBd; and decibel ratios. |

Link Budget, Mesh Planner and Coverage Map model terrain with the Irregular Terrain Model (ITM, also called Longley-Rice), the model behind Radio Mobile and SPLAT!, ported from NTIA's reference code and tested against NTIA's published test cases to within 0.005 dB. It covers line of sight with ground reflection, diffraction over terrain and troposcatter beyond the horizon, from 20 MHz to 20 GHz, with settings for reliability (percent of time), confidence, radio climate, ground type and polarization; above 20 GHz it falls back to ITU-R P.526 Bullington diffraction. These settings sit under their own Longley-Rice model heading. Longley-Rice works from bare-earth elevation, so the environment profiles below still add the trees and buildings around each antenna, and picking one suggests a matching Ground (sea water for Open Water, poor ground for Desert and Urban) unless you've changed Ground yourself. They also offer environment profiles (Open Water, Open Fields, Desert, Light Vegetation, Suburban, Urban, Dense Vegetation) that estimate loss from surrounding clutter using the height-aware model in ITU-R P.2108. They're planning aids, not site surveys. The Mesh Planner and Coverage Map can save named plans, share them by link, and export KML or KMZ for ATAK, WinTAK or Google Earth; the terrain profile exports its path as KMZ and its chart reads out any point you tap. Every field has an ⓘ with a plain-language explanation and typical values. Tabs open in Simple mode with just the essentials; Advanced shows every setting, and hidden settings keep sensible defaults. Every location box accepts decimal lat/lon or MGRS, and a switch in the top bar sets which one the app shows. Link lines follow one standard on every map, with a key under the map: solid green for a good link with clear line of sight, long-dash green for a good link with terrain in the Fresnel zone or across the line of sight, short-dash amber for marginal, and faded red dots for a link that won’t connect. Until terrain has loaded, a good link shows as long-dash green, since its line of sight isn’t confirmed yet. Exports can’t draw dashes, so there the line’s colour, width and description carry the same meaning. Maps have a recenter button, a Clear map button that removes the pins, nodes or coverage on it, and a Streets, Dark or Satellite base map. It starts on Dark in dark mode and Streets in light mode, and each theme remembers your choice across every map.

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

## Contributing

Bug reports, field results and fixes are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © Swamp Fox Labs

## Data and credits

- Terrain elevation (terrain profile, Mesh Planner, Coverage Map): [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) by Mapzen on AWS Open Data. US elevation courtesy of the U.S. Geological Survey (3DEP, SRTM); other regions per the [source list](https://github.com/tilezen/joerd/blob/master/docs/attribution.md).
- Magnetic declination: [World Magnetic Model WMM2025](https://www.ncei.noaa.gov/products/world-magnetic-model) by NOAA NCEI and the British Geological Survey, a U.S. Government work not subject to copyright. The implementation is tested against NOAA's 100 official WMM2025 test values.
- Terrain propagation: the [Irregular Terrain Model](https://github.com/NTIA/itm) (ITM v1.4) by the National Telecommunications and Information Administration (NTIA), a U.S. Government work not subject to copyright in the United States, provided by NTIA as is. Ported to TypeScript by Swamp Fox Labs in November 2026 (point-to-point mode only); the port is tested against NTIA's test cases.
- MGRS conversion: [mgrs](https://github.com/proj4js/mgrs) by the proj4js project (MIT).
- Map tiles: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, drawn with [Leaflet](https://leafletjs.com/).
- Satellite layer: [USGS The National Map](https://www.usgs.gov/programs/national-geospatial-program/national-map) imagery in the US (public domain), and worldwide [EOxCloudless](https://cloudless.eox.at) by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024), used under its non-commercial CC BY-NC-SA 4.0 license. Any commercial use of this toolkit would need to replace the worldwide layer first.
