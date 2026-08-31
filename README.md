# Goribu

A React framework for Cloudflare Workers. Server-rendered and hydrated by
default, with the platform's own primitives — workerd, Static Assets, Wrangler —
as first-class parts of the pipeline rather than adapted afterwards.

Pre-release and under active development.

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

- [Installation](docs/installation.md) — requirements and project setup.
- [CLI reference](docs/cli.md) — every command in detail.
- [Deploying](docs/deploy.md) — authentication and deploys.

A complete example app lives in [`fixtures/basic-app`](fixtures/basic-app).
