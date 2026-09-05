# Goribu Split

A minimal bill splitter generated with `create-goribu` for the second-app proof.
Enter a euro amount and 1–100 people. The calculation uses whole cents, assigning
any remainder one cent at a time so the shares add up exactly.

Live: https://goribu-split.aggelos-gesoulis.workers.dev.

Both routes are statically output: `/` contains the hydrated calculator and
`/about` explains the calculation. There are no accounts, stored bills, D1/KV
resources, API handlers, or added dependencies. Changing inputs requires
JavaScript; returning from About starts a fresh example.

## Install and run

Use Node 22+ and pnpm. From the repository root, first pack the unpublished
framework if its archive is missing:

```sh
pnpm --dir packages/goribu pack --pack-destination "$PWD/examples/.artifacts"
```

Then the maintainer runs:

```sh
pnpm --dir examples/goribu-split install
pnpm --dir examples/goribu-split dev
```

This app has its own pnpm workspace and installation. Its framework dependency is
`file:../.artifacts/goribu-0.0.0.tgz`, not a link to framework source. Keep that
ignored archive available for future installs. The relative path lets the source
checkout move without recording one developer's absolute path. Framework changes
require a deliberate repack and app reinstall.

## Validate

From this app directory:

```sh
pnpm test
pnpm build
pnpm check
```

Tests use Node's built-in runner and need no extra test package. They cover exact
cent totals, uneven splits, tiny/large bills, and invalid input. The build should
report both `index.html` and `about.html` as static output. The deployment plan
should report no resources or migrations.

In a browser, try €10.00 / 3 (one person pays €3.34 and two pay €3.33), then
€0.01 / 3. Invalid inputs should show a repair message instead of a result.
Use Reset, visit About, and return to check hydrated navigation.

## Deploy

The intended Worker name is `goribu-split`. Confirm it is not used by another app
in your account before deploying. From the repository root, the maintainer runs:

```sh
pnpm --dir examples/goribu-split run deploy
```

If authentication is needed, run
`pnpm --dir examples/goribu-split/node_modules/goribu exec wrangler login` first.
Deployment is production-only. Nothing in the test/build commands deploys or
provisions resources.

## Files

- `src/routes/index.jsx`: accessible inputs and live calculation result.
- `src/split-bill.js`: integer-cent calculation and euro formatting.
- `src/routes/about.jsx`: static explanation and return link.
- `src/routes/_document.jsx`, `src/client-entry.js`, `src/styles.css`: unchanged
  generated Document, hydration entry, and Tailwind setup.
