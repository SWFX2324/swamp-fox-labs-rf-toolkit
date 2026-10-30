# Security policy

## Supported versions

Only the live site gets fixes:
<https://swfx2324.github.io/swamp-fox-labs-rf-toolkit/>

Every push to `main` is tested and deployed there automatically, and an
installed copy picks up the new version the next time it's opened with a
connection. So the fix for a problem is always the current site.

| Version | Supported |
| --- | --- |
| The live site (latest `main`) | Yes |
| Older builds, forks or self-hosted copies | No |

## Reporting a vulnerability

Please don't open a public issue. Report it privately instead:
[**Report a vulnerability**](https://github.com/SWFX2324/swamp-fox-labs-rf-toolkit/security/advisories/new)
(the Security tab, then **Report a vulnerability**). Only the maintainer sees it.

Include what you found, which page or tool it affects, the browser you used, and
steps to reproduce it. You'll hear back within a week. Once it's fixed, the fix
deploys to the live site and the advisory is published, crediting you unless
you'd rather not be named.

Please leave real locations out of reports where you can. Made-up coordinates
show a problem just as well.

## What's in scope

- The app's code in this repository (`src/`), for example script injection
  through a name you type (mesh nodes, saved paths) or through saved data, or a
  crafted link that makes the toolkit run code or change what you've saved.
- The build and deployment: the Vite and service worker configuration and the
  GitHub Actions workflow that tests and publishes the site.

These belong with their own projects, though it helps to hear if one affects
the toolkit:

- GitHub Pages, which hosts the site
- OpenStreetMap's tile servers and AWS Open Data Terrain Tiles, which supply
  the map and elevation tiles
- The libraries the app is built with, such as Leaflet and mgrs
- Your browser, or anything that needs someone who already controls your device

The calculations are planning aids. A result you think is wrong is a bug, not a
security issue, so please open a normal issue for it.

## How the toolkit handles security and privacy

**No server, no accounts.** The site is static files on GitHub Pages and every
calculation runs in your browser. There's no sign-in, no analytics, no cookies
and no backend that receives your data.

**What stays on your device.** Your inputs, saved and recently loaded terrain
paths, mesh plans, locations and preferences are kept in your browser's local
storage for this site. They're never uploaded. Clearing the site's data in your
browser removes them. Your location is read from GPS only when you press **Me**.

**What other services see.** Maps load tiles from `tile.openstreetmap.org`, and
the terrain features load elevation tiles from AWS (`s3.amazonaws.com`, the
Terrain Tiles dataset). As with any web map, those servers see your IP address
and which tiles your browser asks for, which reveals the area you're looking
at. No coordinates, names or settings are sent with those requests.

**Offline copies.** The service worker keeps the app's files, map tiles and
elevation tiles you've viewed, so the toolkit works without a connection. They
live in your browser's cache and are removed with the site's data.

**Code.** Libraries are installed from npm at exact versions recorded in
`package-lock.json` and bundled into the site at build time, so no scripts load
from other sites at runtime. Text you type, such as node and path names, is
inserted into the page as text, never as HTML.

**Repository.** Every push and pull request runs the tests and a type-checked
build. Only `main` deploys. GitHub secret scanning and push protection are on
for this repository.
