<p align="center"><img src="assets/swamp-fox-labs-logo-dark.svg" width="420" alt="Swamp Fox Labs"></p>

# Swamp Fox Labs RF Toolkit

Practical RF calculators for planning radio links in the field: antenna lengths, free-space path loss, coax loss, and more.

**Use it:** <https://swfx2324.github.io/swamp-fox-labs-rf-toolkit/>

It runs entirely in the browser. Once a page has loaded, it keeps working offline, and you can install it to a phone or desktop from the browser menu. Before losing signal, use the download button on any map to save the terrain, land cover and satellite imagery for what's on screen. Street maps can't be saved this way, because OpenStreetMap's tile policy doesn't allow it.

## Calculators

| Calculator | Status | What it does |
| --- | --- | --- |
| Link Analysis | Available | A full two-way point-to-point link between Site A and Site B, each a complete radio (TX power, sensitivity, coax, antenna gain and height): EIRP, free-space path loss and the received signal, link margin and max range in both directions, with the weaker direction rating the link (a 50 W base and a 5 W manpack, say) and the ledger switchable between them. Antenna heights set the radio horizon, which caps max range, and a midpoint Fresnel zone clearance check. Drop TX and RX pins on a map for a real terrain profile: line of sight and Fresnel zone clearance along the whole path, with terrain loss from the Irregular Terrain Model (Longley-Rice) added to the budget, and how much of the time the link holds. An Earth curvature (k) setting checks clearance and the radio horizon at the standard 4/3, at 1, or at the 2/3 worst case microwave links are often planned for. Save paths by name to use them offline. With a relay placed, the profile shows the path through it, hop by hop, or the direct path at a tap. Warns when used on HF, where free-space math doesn't apply. Name each site (shown on pins, the profile, the 3D view and KMZ exports). Add a relay with its own radio to bridge a weak link: place it yourself, or let the app shade every spot where a relay would close both hops and drop it on the strongest; the results then show each hop, checked both ways, and the link through the relay beside the direct one. Coax loss covers LMR-100A to LMR-1700 plus RG-58, RG-8X and RG-213 (RG-213 by default). |
| Coverage Analysis | Available | Shades the area one site can reach on the map, out to 80 km: free-space loss plus Longley-Rice terrain loss along up to 240 radials, solid / marginal / strong areas, coverage percentages, the farthest solid point, and tap-to-read margin anywhere. The TX antenna can be omni, a 120°, 90° or 60° sector, or directional (Yagi, panel or dish), with a pointing direction and downtilt; the pattern follows the 3GPP parabolic model, with beamwidths from the gain. Field readings let you log the signal you actually measured at a spot, by GPS or by tapping the map, and see each one against the map's prediction there, with the average error and spread, a breakdown by land cover, a CSV export, and an option to correct the map by the average error. Radio and antenna changes recalculate instantly, and mapped areas work offline. |
| Mesh Analysis | Available | Drop up to 10 nodes on a map and see every node-to-node link over real terrain, checked both ways: margin, terrain loss and a solid / marginal / no-link rating, link lines on the map, and whether the mesh holds together or splits into groups, with the most hops between nodes. Each node can have an omni, sector or directional antenna and a pointing direction, and the Earth curvature (k) setting applies to its line-of-sight check. Nodes share the net's radio on the Radios card unless a node picks its own preset or custom TX power, antenna gain, cable loss and sensitivity (a 50 W base or vehicle set among 5 W manpacks, say); data rates and the hop limit always come from the net's preset, since a mesh runs one waveform; each link is rated by its weaker direction, and the link table says which way that is. Save your own **radio presets** (the app ships none: you name each radio and enter its numbers from your datasheet): TX power, antenna gain, cable loss, optional frequency, a hop limit, whether relays share one channel, and a **rate ladder** of data rates with the sensitivity each needs. With a preset picked for the net, its power, gain, cable and sensitivity fold into one line on the Radios card (Override opens them). With a ladder, each link shows the fastest rate it holds with your fade margin, and every pair of nodes gets its best end-to-end throughput within the hop limit (on a shared channel each hop's airtime adds up; otherwise the slowest hop sets the pace; protocol overhead isn't counted). Pairs that need more hops than the limit are flagged. Presets stay on the device; export and import them as a file to move them, and a shared plan carries the preset it uses. |
| Antenna Length | Available | Cut lengths in feet-and-inches and metric for a half-wave dipole, full-wave dipole, end-fed half-wave, quarter-wave ground plane, 5/8-wave vertical, full-wave loop, J-pole and coax quarter-wave stubs, with band presets, an adjustable shortening factor and feed-point notes. |
| Sat Pointing | Available | Azimuth (true and compass), elevation and linear polarization skew from your location to a geostationary orbital slot, with reflector tilt for offset dishes, slant range and delay, and a bearing line on the map. Compass azimuth uses the built-in World Magnetic Model (WMM2025), so it works offline. |
| Sat Link | Available | Uplink and downlink budget for a GEO terminal: dish gain and beamwidth, terminal EIRP and G/T, C/N0 each way and combined, and Es/N0 margin against any DVB-S2 modulation and FEC rate, with rain fade and its added sky noise. |
| Coax Loss | Available | Loss, power delivered and SWR at the radio for a coax run, including the extra loss a high SWR causes, with every cable compared side by side for the same frequency and length. |
| Power Plan | Available | List your gear with data plate watts, or volts and amps (AC or DC), and how many of each. Totals every line and the whole load, and recommends the smallest generator, from 5 to 60 kW, that carries it inside a planning limit, 80% by default. Save gear you use often to your equipment list and add it again with just a new quantity. Exports a CSV for Excel with every line and the total load. |
| RF Converter | Available | Linked converters for watts, dBm, dBW, microvolts and S-meter readings; SWR, return loss, reflection coefficient and mismatch loss; dBi and dBd; and decibel ratios. |
| Settings | Available | Opened from the gear in the top right. The starting values for the Link Analysis, Mesh Analysis and Coverage Analysis: prediction standard, equipment, environment, Longley-Rice inputs and units. See [Settings](#settings) below. |

## How the modeling works

These are planning aids, not site surveys.

### Terrain

Link Analysis, Mesh Analysis and Coverage Analysis use the **Irregular Terrain Model** (ITM, also called Longley-Rice), the model behind Radio Mobile and SPLAT!.

- Ported from NTIA's reference code and matches NTIA's published test cases to within 0.005 dB.
- Covers line of sight with ground reflection, diffraction over terrain, and troposcatter beyond the horizon, from 20 MHz to 20 GHz.
- Above 20 GHz it falls back to ITU-R P.526 Bullington diffraction.
- Settings for reliability, confidence, radio climate, ground type and polarization sit under the **Longley-Rice model** heading.

### Trees and buildings

Longley-Rice works from bare-earth elevation, so an **Environment** setting adds the clutter around each antenna using ITU-R P.2108.

- Profiles: Open Water, Open Fields, Desert, Light Vegetation, Suburban, Urban, Dense Vegetation.
- **Dense Vegetation** follows ITU-R P.833's measurements in woodland instead. An antenna below the canopy is worked from its real height, not lifted to the treetops, and loses the measured woodland loss on top: about 6 dB at 50 MHz, 10 dB at 150 MHz and 15 dB at 400 MHz. An antenna above the canopy loses nothing to the trees. Set **Tree height** to match your forest (20 m, or 66 ft, by default); mature southern pine is often 70–90 ft.
- **From land-cover map** reads the profile at each end of every path from a 10 m satellite map. On the Coverage Analysis, every point gets the clutter where it is.
- Picking a profile suggests a matching Ground (sea water for Open Water, poor ground for Desert and Urban) unless you've set Ground yourself.

## Using the maps

- **Link lines** follow one standard, with a key under each map:
  - Solid green: good link, clear line of sight.
  - Long-dash green: good link, but terrain in the Fresnel zone or line of sight (or terrain not loaded yet).
  - Short-dash amber: marginal.
  - Faded red dots: won't connect.

  Exports can't draw dashes, so there the colour, width and description carry the meaning.
- **Base maps:** Streets, Dark or Satellite. Dark mode starts on Dark, light mode on Streets, and each remembers your choice.
- **Buttons:** recenter, and Clear map to remove pins, nodes or coverage.
- **Plans:** the Mesh Analysis and Coverage Analysis save named plans, share them by link, and export KML or KMZ for ATAK, WinTAK or Google Earth. The terrain profile exports its path as KMZ, and tapping its chart reads out that point.
- **3D view:** the 3D button on the Link Analysis, Mesh Analysis and Coverage Analysis maps opens the area on real terrain that you can tilt and turn, with satellite or map imagery and adjustable height. Links follow the ground in the same colours and dashes as the 2D key, and coverage shading drapes over the hills inside its radius. Drag a pin, node or site to move it; the tab recalculates (the Coverage Analysis maps again) and the 3D view follows. Turn on **Line of sight** to see each link's straight path between antenna tops, lowered for the earth's curve so clearance matches the 2D check: where a ridge rises through it, the link is blocked. Click a label to edit without leaving 3D: on the Link Analysis a site's name, power, sensitivity, antenna gain and height, or location (the relay and its shading show there too); on the Coverage Analysis the site's name, power, antenna, height, sensitivity, radius or location, which maps it again; on the Mesh Analysis a node's name, height, antenna and aim, or location. On a phone the editor docks to the bottom of the screen, or down the right side in landscape, where the bar and key shrink to leave the most room for the terrain.

## Settings

One place for the assumptions behind every prediction. The Link Analysis, Mesh Analysis and Coverage Analysis start from these values; change a field on one of those tabs for a particular link and it keeps your value there until you press that tab's Reset, while everything you haven't touched follows Settings. Saved plans and share links carry the sender's values, so a plan reads the same on any device.

The defaults lean cautious, since a prediction that says a link won't work when it would is far cheaper than one that says it will when it won't:

| Setting | Default |
| --- | --- |
| Reliability / Confidence | 90% / 90% |
| Fade margin | 10 dB |
| Earth curvature (k) | 2/3 |
| Antenna gain | −3 dBi |
| Antenna height | 6 ft |
| Cable loss (Mesh Analysis, Coverage Analysis) | 0.5 dB per end; the Link Analysis works cable loss from cable type and length |
| Connector / coupler loss | 0.25 dB each, 2 per end |
| Sensitivity derating | 3 dB: receivers are taken as this much less sensitive than the number typed |
| Environment | From land-cover map |
| Land-cover fallback | Dense Vegetation, wherever the map has no data (offline, not loaded yet, or failed) |
| Tree height | 66 ft (20 m) |
| Radio climate / Ground / Polarization | Continental temperate / Average ground / Vertical |
| Units | Feet, miles, Lat/Lon (the top-bar switch changes the same setting) |

## Everywhere in the app

- **Simple and Advanced:** tabs open in Simple mode with just the essentials. Advanced shows every setting; hidden ones keep sensible defaults.
- **Help:** every field has an ⓘ with a plain-language explanation and typical values.
- **Coordinates:** location boxes accept decimal lat/lon or MGRS. The switch in the top bar and the one in Settings set which one the app shows.

## Coax data

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

- Terrain elevation (terrain profile, Mesh Analysis, Coverage Analysis): [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) by Mapzen on AWS Open Data. US elevation courtesy of the U.S. Geological Survey (3DEP, SRTM); other regions per the [source list](https://github.com/tilezen/joerd/blob/master/docs/attribution.md).
- Magnetic declination: [World Magnetic Model WMM2025](https://www.ncei.noaa.gov/products/world-magnetic-model) by NOAA NCEI and the British Geological Survey, a U.S. Government work not subject to copyright. The implementation is tested against NOAA's 100 official WMM2025 test values.
- Terrain propagation: the [Irregular Terrain Model](https://github.com/NTIA/itm) (ITM v1.4) by the National Telecommunications and Information Administration (NTIA), a U.S. Government work not subject to copyright in the United States, provided by NTIA as is. Ported to TypeScript by Swamp Fox Labs in November 2026 (point-to-point mode only); the port is tested against NTIA's test cases.
- Land cover ("From land-cover map"): [Sentinel-2 10 m Land Use/Land Cover](https://www.arcgis.com/home/item.html?id=cfcb7609de5f478eb7666240902d4d3d) by Impact Observatory, Microsoft and Esri (the 2025 map). The land-cover data is CC BY 4.0; it's read from Esri's public image service, which is provided under Esri's terms of use.
- MGRS conversion: [mgrs](https://github.com/proj4js/mgrs) by the proj4js project (MIT).
- Map tiles: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, drawn with [Leaflet](https://leafletjs.com/); the 3D view uses [MapLibre GL JS](https://maplibre.org/) (BSD 3-Clause).
- Satellite (hybrid) layer: [USGS The National Map](https://www.usgs.gov/programs/national-geospatial-program/national-map) Imagery Topo in the US, imagery with US Topo roads and names (public domain); outside the US, place and road names from the [EOX::Maps](https://maps.eox.at) overlay (data © OpenStreetMap contributors, rendering © EOX and MapServer), and worldwide [EOxCloudless](https://cloudless.eox.at) by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024), used under its non-commercial CC BY-NC-SA 4.0 license. Any commercial use of this toolkit would need to replace the worldwide layer first.
