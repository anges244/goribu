# Environment variables

Put local values in `.env`, production values in `.env.production`, and examples
with placeholders in `.env.example`. Keep the first two out of Git; commit the
example so another developer knows which keys the application needs.

## Local Worker values

Create `.env` beside `goribu.config.js`:

```dotenv
API_KEY=your-development-key
```

Read it from a route handler through the Worker bindings:

```js
export async function GET(req, res) {
  const response = await fetch("https://api.example.com/items", {
    headers: { Authorization: `Bearer ${req.env.API_KEY}` },
  });
  return res.json(await response.json());
}
```

Cloudflare loads `.env` and then `.env.local`; the latter overrides matching
keys. Alternatively, use `.dev.vars`. A present `.dev.vars` suppresses **both**
`.env` and `.env.local` for Worker bindings, even when it contains no values.
These are Cloudflare's file-selection rules, not files Goribu merges together.
Edits to the loaded files restart the development session.

Goribu generates `goribu.wrangler.jsonc` at the project root so Cloudflare can
find those files beside its configuration. This file and `.goribu/` are generated
and should be ignored by Git. Configure `goribu.config.js`; do not edit the
generated Wrangler file.

When R2 is configured, Goribu creates and reuses its own `.goribu/dev-secret`
for local signing. It supplies this as a serve-only `GORIBU_SECRET` fallback
in memory; a value in the root env files takes precedence. Goribu reads only
its generated secret file, never parses app-authored env files, and does not
write that fallback into generated Wrangler files or production output.

Goribu does not select a named Cloudflare environment automatically.
`.dev.vars.local` is not a local override: `.dev.vars.<name>` refers to a
Cloudflare environment with that name. Advanced Cloudflare environment selection
is separate from Vite's development/production mode.

## Production secrets

Put production values in `.env.production`:

```dotenv
API_KEY=your-production-key
```

When this file exists, `goribu deploy` passes it unchanged to Wrangler through
`--secrets-file=.env.production`. Wrangler uploads its values as Worker secrets,
available through the same `req.env.API_KEY` in production. Secrets omitted from
the file keep their previously deployed values. Removing a line does not delete
the corresponding Cloudflare secret.

If the file is absent, deploy reports that it will use existing platform secrets.
It never falls back to `.env`, `.env.local`, or `.dev.vars` for this upload.

After building and before resource provisioning or migrations, Goribu runs a
Wrangler dry run with the production secrets file. Wrangler validates the built
Worker and parses the file with its own rules. An unreadable file or input
Wrangler rejects stops the deploy before those mutations. An empty dotenv file
is rejected; remove it if you intend to use existing secrets. This is format
validation, not proof that an API key works with its service. Parser output is
suppressed so an error cannot print secret source text.

The error provides a command to reproduce the failure using Goribu's bundled
Wrangler. Run it from the app directory when you need the underlying diagnostic:

```sh
pnpm exec goribu wrangler deploy --dry-run --secrets-file=.env.production
```

This does not deploy. Its output may include text from the secrets file, so run
it in a terminal where you are comfortable displaying that diagnostic.

`goribu check` reports which file deployment will upload, or that it will use
existing secrets. It does not print values, count keys, or validate file contents;
the deploy preflight owns that validation. Deployment still needs Cloudflare
credentials, and migrations and Worker deployment do not share a transaction.

## Public browser values

Only names starting with `PUBLIC_` are exposed through `import.meta.env`:

```dotenv
PUBLIC_API_ORIGIN=https://api.example.com
```

```js
const origin = import.meta.env.PUBLIC_API_ORIGIN;
```

Vite owns this loading. It reads `.env`, `.env.local`, `.env.<mode>`, and
`.env.<mode>.local`, with later files overriding earlier ones and existing shell
variables taking precedence. The default modes are `development` for dev and
`production` for builds. Public values are baked into the production bundle;
changing a Cloudflare secret later does not change those bundled values.

The production secrets upload includes `PUBLIC_*` keys if they are in
`.env.production`. Storing a value as a Worker secret does not make it private
in the browser bundle. Never give a private API key a `PUBLIC_` prefix.

Cloudflare may also write local values into
`.goribu/dist/<worker>/.dev.vars` for local preview. Wrangler does not deploy
that preview file. Build output can therefore contain local secrets. Cloudflare
owns this preview copy. Goribu's generated `.goribu/dev-secret` is used only
during serve and is excluded from build output.

## Migrating from the older env loader

The older Goribu loader included `.env.development` and
`.env.development.local` in local Worker bindings. That behavior is deliberately
not restored. Move local **server** overrides to `.env.local` (or use
`.dev.vars` with the precedence above).

Vite still reads `.env.development` for `PUBLIC_*` values in browser code. A
value in that file can therefore appear in `import.meta.env.PUBLIC_*` without
appearing in `req.env`. Production server secrets come only from the separate
`.env.production` upload, not Vite's mode-file cascade.

Goribu also no longer loads env files into `process.env` before evaluating
`goribu.config.js`. The config can read variables already supplied by the shell;
there is no implicit dotenv loader for config evaluation. The former loader
served Postgres/Hyperdrive configuration, which this version does not provide.
