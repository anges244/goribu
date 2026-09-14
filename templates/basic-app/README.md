# Goribu starter

A small Goribu app with Tailwind, a static hydrated home page, and a
Worker-rendered greeting. D1 and KV are opt-ins, not prerequisites.

## Run this app

Use Node.js 22 or newer and pnpm:

```sh
pnpm install
pnpm dev
```

<!-- typescript-only:start -->
Run `pnpm typecheck` to check the app's types. `pnpm build` bundles the app;
type checking is a separate command. Routes use `.ts` and `.tsx`, while
`goribu.config.js`, `vite.config.js`, and `src/client-entry.js` remain JavaScript
and are checked by the starter's `tsconfig.json` too.

<!-- typescript-only:end -->

`pnpm build` creates production output; `pnpm check` reads the deployment plan.
Development and standalone builds need no Cloudflare login. A generated app is
independent of the framework repository. If it uses a local Goribu tarball,
keep that archive available for future dependency installations.

<!-- repository-only:start -->
## Working in the Goribu repository

Use Node.js 22 or newer. From the repository root, install the workspace
dependencies with `pnpm install`, then run:

```sh
pnpm --dir templates/basic-app dev
pnpm --dir templates/basic-app build
pnpm --dir templates/basic-app check
```

Or, from this app directory, use `pnpm dev`, `pnpm build`, and `pnpm check`.
Development and standalone builds need no Cloudflare login.

The `goribu: workspace:*` dependency selects the framework in this repository.
Before testing outside this workspace, use the local `packages/create-goribu`
CLI with a packed framework tarball. Independent package-install verification
is part of starter validation. This is the canonical source template;
JavaScript output is generated during scaffolder packaging.

<!-- repository-only:end -->

## What to edit

- `goribu.config.js`: Worker name and optional resource declarations.
- `src/routes/index.tsx`: static home page and hydrated counter.
- `src/routes/hello.tsx`: request-time GET handler and its page.
- `src/routes/_document.tsx`: language, viewport, metadata, and framework assets.
- `src/styles.css`: Tailwind entry, scanned against this app's source files.
- `src/client-entry.js`: browser bootstrap and global CSS import.

Tailwind classes must appear as complete strings in source. Use a conditional
between full class names instead of constructing names such as `bg-${color}-500`.
See [Tailwind's source detection guide](https://tailwindcss.com/docs/detecting-classes-in-source-files).

## Optional D1 and KV

Uncomment either declaration in `goribu.config.js`, choosing names for your app:

```js
database: { type: "d1", name: "my-app-db" },
kv: { name: "my-app-kv" },
```

Goribu owns the `DB` and `KV` bindings. Do not add a Wrangler configuration.
Restart dev after changing declarations; local stores are separate from
production. Routes use `req.d1` and `req.kv` in handlers, never in page components.

D1 schema belongs in numbered migrations. From the app directory, scaffold one
with `pnpm exec goribu migrate:new create notes`, edit its SQL, then apply it
locally with `pnpm exec goribu migrate`. Deploy applies pending production
migrations before uploading the Worker. Keep schema changes compatible with the
previously deployed code; deployment and migrations are not one transaction.

KV is eventually consistent. Do not use an immediate reread to confirm a write
or make correctness-sensitive decisions. See the site's
[D1](https://goribu-site.aggelos-gesoulis.workers.dev/docs/d1),
[migrations](https://goribu-site.aggelos-gesoulis.workers.dev/docs/migrations), and
[KV](https://goribu-site.aggelos-gesoulis.workers.dev/docs/kv) guides.

## Deploy deliberately

Put local server values in `.env`, with optional overrides in `.env.local`.
Handlers read them from `req.env`. A `.dev.vars` file takes precedence over both.
Put production secrets in `.env.production`; deployment uploads that file and
preserves existing secrets omitted from it. Without it, existing platform
secrets are used. Local `.env` never becomes a production upload fallback.

Only `PUBLIC_*` values belong in browser code through `import.meta.env`.
Vite loads mode files for those values and bakes them into the build. Worker
bindings do not automatically load `.env.development`; use `.env.local` for
local server overrides. Keep env files private and commit only a placeholder
`.env.example`. `goribu.wrangler.jsonc` is generated; do not edit or commit it.

Choose your Worker name in `goribu.config.js`. From this app directory, log in
with the bundled Wrangler if needed:

```sh
pnpm --dir node_modules/goribu exec wrangler login
pnpm check
pnpm run deploy
```

Keep the explicit `run`: `pnpm deploy` is pnpm's own workspace deployment
command, not this app's deployment script.

For non-interactive authentication, configure `CLOUDFLARE_API_TOKEN`. Set
`CLOUDFLARE_ACCOUNT_ID` when credentials can access multiple accounts.
Deploy checks authentication before building, creates or reuses declared
resources, applies D1 migrations, and uploads to production. It is not a preview.
