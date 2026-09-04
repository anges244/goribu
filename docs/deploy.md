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

This builds the app, prepares declared resources, then runs `wrangler deploy`.
The app is served from its `workers.dev` URL (and any custom domain you have
configured), under the `name` from `goribu.config.js`. Re-running `goribu deploy`
replaces what production serves.

## Deploying with D1

Declare the database in `goribu.config.js`; the application owns its name while
Goribu owns the generated `DB` binding:

```js
import { defineConfig } from "goribu/server";

export default defineConfig({
  name: "my-app",
  compatibilityDate: "2026-09-03",
  database: { type: "d1", name: "my-app-db" },
});
```

Do not add `d1_databases` to a Wrangler file. A duplicate declaration fails the
build with instructions to remove it.

Before deployment, inspect the plan from the application directory:

```
goribu check
```

`check` is read-only. It reports the production Worker target, whether the D1
database exists or will be created, the `DB` mapping, the D1 cost warning, and
the production migration state. Applied, pending, and drifted migrations come
from a read-only ledger query; a missing database or tracking table is reported
without creating either. It finishes by confirming that no resources changed.

On `goribu deploy`, Goribu validates binding ownership and completes the
production build before making a remote change. It then:

1. Creates the declared database when it is missing, enabling replication in the
   same request unless `replication: false` was declared.
2. Reconciles an explicit `replication: true` or `replication: false` on an
   existing database. When the field is omitted, existing replication policy is
   left untouched.
3. Writes the resolved database UUID into the generated production `DB` binding.
4. Verifies migration history and applies every pending migration in order. Drift
   or failed SQL aborts before the Worker upload.
5. Hands the completed Worker and static assets to Wrangler for deployment.

Re-running the command finds and reuses the database by name; deploying new code
does not recreate or erase its data. Authentication must be able to deploy the
Worker and edit D1 resources. If Wrangler can access more than one Cloudflare
account, set `CLOUDFLARE_ACCOUNT_ID` so Goribu does not have to guess.

Development uses a local D1 database keyed by the declared name. It does not
connect development requests to production data.

### Migration ordering

`goribu deploy` applies pending migration SQL after D1 exists and before the new
Worker is uploaded. That closes the first-deploy gap where code could become live
before its tables existed. If migration history has drifted or a pending file
fails, the new Worker is not uploaded. A database created earlier in the command
and any earlier migration files that completed successfully can remain.

You can still advance production schema deliberately before a deploy:

```sh
goribu migrate --remote
```

There is no `--no-migrations` deploy flag. Running the explicit command first is
the canonical timing control; the following deploy verifies the same history and
finds nothing pending. A Worker deployment and D1 migration still cannot share
one transaction. The previously deployed Worker continues serving while schema
changes and upload run, so pending migrations must be compatible with it. See
[Migrations](./migrations.md) for the complete expand-and-contract sequence.

## What to expect

- `goribu deploy` prints Wrangler's own output, including the resulting URL.
- D1 provisioning prints only changes it made; an existing matching database is
  reused without a creation message.
- A failed or interrupted deploy exits non-zero and does not report success.
- The build output lives in `dist/`; `.wrangler/deploy/config.json` redirects
  Wrangler to the emitted Worker configuration and static assets there. The
  redirect, build output, and `.goribu/` build inputs are generated and are not
  committed.
