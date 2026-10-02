# Deploying a Goribu app

Goribu deploys through [Wrangler](https://developers.cloudflare.com/workers/wrangler/),
Cloudflare's own tool. You run the deploy yourself; there is no automated
per-commit pipeline. Every deploy checks credentials and account selection before
building. The Worker and static assets you upload are exactly what that build
produced.

## Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up).

Wrangler ships as a Goribu dependency, so there is nothing extra to install.
Authenticate one of these ways:

- **Interactive (local):** run `pnpm exec goribu cloudflare-login` from the app
  directory to authorize your Cloudflare account in the browser. Goribu uses its
  installed Wrangler, which stores the credentials for later runs.
- **Non-interactive (no browser, e.g. a server):** set `CLOUDFLARE_API_TOKEN`
  in the environment (add `CLOUDFLARE_ACCOUNT_ID` if the token can reach more
  than one account). Create the token from the "Edit Cloudflare Workers"
  template in the Cloudflare dashboard.

Deploy fails before building if authentication or account selection fails; it
does not launch an interactive login itself. Repair the reported problem, then
rerun `goribu deploy`. Standalone `goribu build` does not require Cloudflare
authentication.

## Deploy to production

From the app directory:

```
goribu deploy
```

This validates configuration, checks Wrangler credentials and account selection,
builds the app, prepares declared resources, then runs `wrangler deploy`.
The app is served from its `workers.dev` URL (and any custom domain you have
configured), under the `name` from `goribu.config.js`. Re-running `goribu deploy`
replaces what production serves.

To watch live Worker requests, console output, and errors after deployment, run
[`goribu tail`](./cli.md#goribu-tail) from the app directory. It streams the
configured Worker's logs without rebuilding or deploying; Ctrl+C closes the
stream.

If `.env.production` exists at the app root, deploy uploads it unchanged as
Worker secrets through Wrangler. Omitted secrets are preserved. If absent,
existing platform secrets are used; local `.env` is never an upload fallback.
A Wrangler dry run validates the file and built Worker before provisioning or
migrations. See [Environment variables](./environment-variables.md) for local
loading, public browser values, and migration from the older loader.

## Custom domain

Add one line to `goribu.config.js` to connect an application hostname:

```js
import { defineConfig } from "goribu/server";

export default defineConfig({
  name: "my-app",
  compatibilityDate: "2026-10-02",
  domain: "app.example.com",
});
```

`domain` accepts one bare hostname, either a zone apex or a subdomain. Goribu
normalizes it to lowercase and rejects schemes, paths, ports, IP addresses,
wildcards, and Cloudflare-managed `workers.dev` or `r2.dev` addresses. Use a
different hostname for `r2.domain` when serving public bucket files.

The hostname must belong to an active Cloudflare zone in the selected deployment
account. Goribu finds the most specific matching zone; no zone ID is needed in
configuration. Cloudflare creates the custom domain's DNS records and TLS
certificate. Connection does not mean DNS and certificate activation have
finished. See [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

Run `goribu check` to preview the connection without making changes. A hostname
already connected to this Worker is reused. Another Worker's attachment or a
conflict reported by Cloudflare's domain preview blocks the operation with
repair instructions. If the Worker does not exist yet, check explains that the
conflict preview must wait until the first Worker upload.

Your normal `goribu cloudflare-login` works for domain management. Goribu uses
Cloudflare's native domain preview and attachment operations, so there is no
separate DNS Read requirement. If you use an API token, it needs Workers Scripts
Write and Zone Read for the target zone alongside the app's other deployment
permissions.

`goribu deploy` checks the domain before provisioning resources or applying
migrations, deploys the Worker, then checks again and attaches the hostname if
needed. The attachment keeps Cloudflare's Worker and DNS replacement overrides
disabled, including when a conflict appears after the preview. If attachment or
verification fails after upload, the command reports that the Worker is already
deployed and exits with an error. Inspect the reported conflict or connection,
then retry deployment; Goribu never rolls back by disconnecting a domain.

The `workers.dev` address and existing dashboard-managed domains stay available.
Changing or removing `domain` does not disconnect the old hostname. With a domain
configured, check and deploy list other connected app domains as information.
Manage those connections in the Worker's **Settings > Domains & Routes**. When the
field is omitted, Goribu skips domain management entirely. The field connects
the exact hostname; `www` aliases and redirects remain separately configured in
Cloudflare.

Development and standalone builds validate the hostname without contacting
Cloudflare. For [R2 direct uploads](r2.md#direct-upload-deployment), the planned
application domain's HTTPS origin enters the CORS plan before attachment.

## Deploying with D1 and KV

Declare either or both resources in `goribu.config.js`; the application owns
their names while Goribu owns the generated `DB` and `KV` bindings:

```js
import { defineConfig } from "goribu/server";

export default defineConfig({
  name: "my-app",
  compatibilityDate: "2026-09-03",
  database: { type: "d1", name: "my-app-db" },
  kv: { name: "my-app-kv" },
});
```

Do not add `d1_databases` or `kv_namespaces` to a Wrangler file alongside the
corresponding Goribu declaration. A duplicate declaration fails the build with
instructions to remove it, including declarations under Wrangler environments.

Before deployment, inspect the plan from the application directory:

```
goribu check
```

`check` is read-only. It reports the production Worker target, whether each D1/KV
resource exists or will be created, the `DB`/`KV` mappings, cost warnings, and
the production migration state. It also reports the intended secrets file or
that existing platform secrets will be used, without reading values or counting
keys. Applied, pending, and drifted migrations come
from a read-only ledger query; a missing database or tracking table is reported
without creating either. It finishes by confirming that no resources changed.

On `goribu deploy`, Goribu validates binding ownership, checks authentication,
and completes the production build and any production secrets preflight before
changing any production resources.
The credential/account result is reused by both provisioners within that deploy;
it is not stored by Goribu. Authentication checks also run for apps with no D1
or KV declaration. They do not prove every later operation has permission or
guarantee credentials and connectivity remain valid. Goribu then:

1. Creates the declared database when it is missing, enabling replication in the
   same request unless `replication: false` was declared.
2. Reconciles an explicit `replication: true` or `replication: false` on an
   existing database. When the field is omitted, existing replication policy is
   left untouched.
3. Creates the declared KV namespace if missing, or reuses the exact matching
   namespace title. Ambiguous resource matches fail closed.
4. Writes both resolved resource ids into the generated production bindings.
5. Verifies D1 migration history and applies every pending migration in order.
   Drift or failed SQL aborts before the Worker upload.
6. Hands the completed Worker and static assets to Wrangler for deployment.

Undeclared resources are skipped. A KV-only app has no migration step.

Re-running the command finds and reuses resources by name; deploying new code
does not recreate or erase their data. Changing a declared name selects a
different resource; it does not rename or delete the old one. Removing a
declaration does not delete the Cloudflare resource either.

Authentication must be able to deploy the Worker and read/write the declared
D1 and Workers KV Storage resources. If Wrangler can access more than one
Cloudflare account, set `CLOUDFLARE_ACCOUNT_ID` so Goribu does not have to guess.

Development uses local D1 and KV stores keyed by their declared names. It does
not connect development requests to production data. See [KV](./kv.md) for the
runtime API and eventual-consistency limits; deploying a Worker does not flush
KV's distributed read caches.

### Migration ordering

`goribu deploy` applies pending migration SQL after D1 exists and before the new
Worker is uploaded. That closes the first-deploy gap where code could become live
before its tables existed. If migration history has drifted or a pending file
fails, the new Worker is not uploaded. Resources created earlier in the command
and any earlier migration files that completed successfully can remain. The
command does not roll back resource creation if a later operation fails.

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
- D1/KV provisioning prints only changes it made; an existing matching resource is
  reused without a creation message.
- A failed or interrupted deploy exits non-zero and does not report success.
- The build output lives in `.goribu/dist/`; `.wrangler/deploy/config.json` redirects
  Wrangler to the emitted Worker configuration and static assets there. The
  redirect, build output, `goribu.wrangler.jsonc`, and `.goribu/` build inputs are generated and are not
  committed.
