# Swamp Fox Labs RF Toolkit

Practical RF calculators for planning radio links in the field: antenna lengths, free-space path loss, coax loss, and more.

**Use it:** <https://swfx2324.github.io/swamp-fox-labs-rf-toolkit/>

It runs entirely in the browser. Once a page has loaded, it keeps working offline, and you can install it to a phone or desktop from the browser menu.

## Calculators

| Calculator | Status | What it does |
| --- | --- | --- |
| Link Budget | Available | A full point-to-point link: TX power, coax loss and antenna gain to EIRP, free-space path loss, then RX antenna and coax to the received signal, link margin and max range. Antenna heights set the radio horizon, which caps max range, and a midpoint Fresnel zone clearance check. Warns when used on HF, where free-space math doesn't apply. Coax loss covers LMR-100A to LMR-1700 plus typical RG-58, RG-8X and RG-213. |
| Antenna Length | Planned | Element lengths for dipoles, quarter-wave verticals and other common antennas at a given frequency. |
| Coax Loss | Planned | A standalone coax comparison by frequency and run length (the math already lives in the link budget). |

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
