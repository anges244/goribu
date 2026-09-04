---
title: Deploying
description: Deploy to Cloudflare with one command.
---

Goribu deploys through
[Wrangler](https://developers.cloudflare.com/workers/wrangler/), Cloudflare's own
tool. You run the deploy yourself; there is no automated per-commit pipeline.
Every deploy first runs the production build, so the Worker and static assets you
upload are exactly what the build produced.

## Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up).

Wrangler ships as a Goribu dependency, so there is nothing extra to install. You
do not run Wrangler directly — Goribu runs its own copy — so authenticate one of
these ways:

- **Interactive (local):** just run `goribu deploy`. If you are not already
  authenticated, Wrangler opens your browser to authorize your Cloudflare account
  and then continues; the login is remembered for later runs.
- **Non-interactive (no browser, e.g. a server):** set `CLOUDFLARE_API_TOKEN` in
  the environment (add `CLOUDFLARE_ACCOUNT_ID` if the token can reach more than
  one account). Create the token from the "Edit Cloudflare Workers" template in
  the Cloudflare dashboard.

## Deploy to production

From the app directory:

```
goribu deploy
```

This builds the app, prepares declared resources, then runs `wrangler deploy`.
The app is served from its `workers.dev` URL (and any custom domain you have
configured), under the `name` from `goribu.config.js`. Re-running `goribu deploy`
replaces what production serves.

## D1 and migration status

Declare one database in `goribu.config.js`, then inspect production before
deploying:

```sh
goribu check
```

Check is read-only. It reports whether the database exists, the generated `DB`
binding, cost information, and real production applied, pending, and drifted
migrations. A missing tracking table is read as nothing applied and is not
created by inspection.

Deploy creates a missing database, verifies migration history, and applies every
pending file before it uploads the new Worker. Drift or failed SQL aborts the
upload. To advance a compatible production schema earlier, run:

```sh
goribu migrate --remote
```

There is no deploy skip flag; the explicit command is the timing control, and a
later deploy simply verifies there is nothing pending. Worker upload and schema
change are still not one transaction: the old Worker serves while migrations
run, so use compatible expand changes and defer destructive contract changes to
a later release. See [Migrations](/docs/migrations) for the complete sequence.

## What to expect

- `goribu deploy` prints Wrangler's own output, including the resulting URL.
- D1 provisioning prints only changes it made; an existing database is reused.
- A failed or interrupted deploy exits non-zero and does not report success.
- The build output lives in `dist/`; the deploy target is resolved from the
  generated Wrangler configuration under `.goribu/`. Neither is committed.
