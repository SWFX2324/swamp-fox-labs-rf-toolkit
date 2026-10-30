# Swamp Fox Labs RF Toolkit

Practical RF calculators for planning radio links in the field: antenna lengths, free-space path loss, coax loss, and more.

**Use it:** <https://swfx2324.github.io/swamp-fox-labs-rf-toolkit/>

It runs entirely in the browser. Once a page has loaded, it keeps working offline, and you can install it to a phone or desktop from the browser menu.

## Calculators

| Calculator | Status | What it does |
| --- | --- | --- |
| Free-Space Path Loss | Available | Signal loss over a line-of-sight distance at a given frequency, and the distance a loss budget allows. |
| Antenna Length | Planned | Element lengths for dipoles, quarter-wave verticals and other common antennas at a given frequency. |
| Coax Loss | Planned | Feed line loss for common coax types by frequency and run length. |

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
