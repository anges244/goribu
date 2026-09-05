# Goribu

A React framework for Cloudflare Workers. Server-rendered and hydrated by
default, with the platform's own primitives — workerd, Static Assets, Wrangler —
as first-class parts of the pipeline rather than adapted afterwards.

Under active development. This checkout is preparing `goribu@0.7.0` and
`create-goribu@0.7.0`; neither replacement has been published yet. Follow the
[getting-started guide](docs/getting-started.md) for the current local-package
setup. See [Releasing](docs/releasing.md) for the shared version policy.

## Commands

Run from an app directory (where `goribu.config.js` lives):

| Command | What it does |
|---|---|
| `goribu dev` | Start the local dev server (Vite + workerd) with HMR. |
| `goribu build` | Produce the production Worker and client bundles. |
| `goribu deploy` | Build and deploy to Cloudflare. |

`goribu --help` prints usage; `goribu --version` prints the version.

## Running the example in this repo

This repository is a pnpm workspace, and its example app is
[`fixtures/basic-app`](fixtures/basic-app). Run the CLI against it through the
workspace filter from the repo root:

```
pnpm --filter basic-app exec goribu dev
pnpm --filter basic-app exec goribu build
pnpm --filter basic-app exec goribu deploy
```

Or from inside the app directory:

```
cd fixtures/basic-app
pnpm exec goribu dev
```

## Docs

- [Getting started](docs/getting-started.md) — create and deploy a starter app.
- [Installation reference](docs/installation.md) — requirements and project files.
- [CLI reference](docs/cli.md) — every command in detail.
- [Deploying](docs/deploy.md) — authentication and deploys.

A complete example app lives in [`fixtures/basic-app`](fixtures/basic-app).
