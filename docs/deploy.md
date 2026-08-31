# Deploying a Goribu app

Goribu deploys through [Wrangler](https://developers.cloudflare.com/workers/wrangler/),
Cloudflare's own tool. You run the deploy yourself; there is no automated
per-commit pipeline. Every deploy first runs the production build, so the Worker
and static assets you upload are exactly what the build produced.

## Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up).

Wrangler ships as a Goribu dependency, so there is nothing extra to install. You
do not run Wrangler directly — Goribu runs its own copy — so authenticate one of
these ways:

- **Interactive (local):** just run `goribu deploy`. If you are not already
  authenticated, Wrangler opens your browser to authorize your Cloudflare
  account and then continues; the login is remembered for later runs.
- **Non-interactive (no browser, e.g. a server):** set `CLOUDFLARE_API_TOKEN`
  in the environment (add `CLOUDFLARE_ACCOUNT_ID` if the token can reach more
  than one account). Create the token from the "Edit Cloudflare Workers"
  template in the Cloudflare dashboard.

## Deploy to production

From the app directory:

```
goribu deploy
```

This builds the app, then runs `wrangler deploy`. The app is served from its
`workers.dev` URL (and any custom domain you have configured), under the `name`
from `goribu.config.js`. Re-running `goribu deploy` replaces what production
serves.

## Deploy a preview

```
goribu deploy --preview
```

This builds the app, then runs `wrangler versions upload`. It uploads a new
version and prints a public **preview URL** for that version **without changing
what production serves**. Use it to share a change, or to check a commit on a
real URL before promoting it.

Run it once per commit you want a URL for. Because it does not touch production,
it is safe to run from any branch.

## What to expect

- Both commands print Wrangler's own output, including the resulting URL.
- A failed or interrupted deploy exits non-zero and does not report success.
- The build output lives in `dist/`; the deploy target is resolved from the
  generated Wrangler configuration under `.goribu/`. Neither is committed.
