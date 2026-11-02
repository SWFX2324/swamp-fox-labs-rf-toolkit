# Contributing

Thanks for helping. Bug reports, field results and fixes are all useful, and you don't need to write code to contribute.

By taking part, you agree to follow the [code of conduct](CODE_OF_CONDUCT.md).

**Issues and pull requests are public.** Leave out real locations, details of real operations, and share links or saved plans that contain them. Made-up coordinates show a problem just as well.

## Reporting a problem or an idea

- **Something's broken or a result looks wrong:** open a [bug report](https://github.com/SWFX2324/swamp-fox-labs-rf-toolkit/issues/new?template=bug_report.yml).
- **You have an idea:** open a [feature request](https://github.com/SWFX2324/swamp-fox-labs-rf-toolkit/issues/new?template=feature_request.yml).
- **You found a security problem:** follow [SECURITY.md](SECURITY.md) and don't open a public issue.

### Field results

The prediction models haven't been fully validated against real links, so measurements are especially valuable. If a prediction didn't match what you measured, open a bug report and include:

- Frequency, TX power and radio model
- Antenna type, gain and height at each end
- Cable type and length at each end
- Several received signal readings
- Path distance, and a note on the terrain and vegetation

Only share a location you're comfortable making public, such as a public test site.

## Before you write code

For anything bigger than a small fix, open an issue first so we can agree on the approach. The toolkit is meant to stay focused and simple enough for field use, so not every good idea will fit.

## Setting up

You need Node.js 24 or later.

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

`npm run dev` starts a local server, `npm test` runs the unit tests, and `npm run build` type-checks and builds to `dist/`.

## How the code is organized

- **`src/lib`:** the formulas and other logic, as plain functions with no UI code. Each has tests beside it.
- **`src/calculators`:** one file per tool, plus shared pieces such as `mapKit.ts` for maps and `fieldHelp.ts` for field help and Simple/Advanced mode.
- **`src/calculators/helpText.ts`:** the ⓘ wording, and which fields are hidden in Simple mode.

## Guidelines

**Formulas**
- Test against reference values from a published source, and cite the source in the code or README.
- Be clear about what a result leaves out. These are planning aids, and a result shouldn't look more certain than it is.

**Interface**
- Keep Simple mode short and put specialist settings in Advanced.
- Give new fields plain-language help text.
- Check desktop and phone widths, with touch targets big enough for gloves.
- Match the wording and code style around your change.
- Don't name a form field `length`, because it conflicts with `form.elements.length`.

**Offline, privacy and data**
- The app has no server, accounts or analytics, and inputs stay on the device. Keep it that way.
- Calculators should keep working offline once loaded. Anything that needs a connection should fail with a clear message.
- Check the license and usage policy of any new data source or service, and credit it in the README. Update `SECURITY.md` if it changes what other services can see.
- **Never bulk-download or prefetch OpenStreetMap tiles.** OpenStreetMap's tile policy forbids it, so "save this view" stores only terrain and satellite tiles.
- Prefer no new dependency when a small amount of code will do.

## Sending a pull request

1. Fork the repository and create a branch from `main`.
2. Keep the pull request to one change, and add tests for any logic you add or fix.
3. Run `npm test` and `npm run build`. The same checks run on your pull request.
4. Fill in the pull request template.

Every push to `main` deploys straight to the live site, so changes get checked closely before they're merged.

Contributions are released under the project's [MIT license](LICENSE).
