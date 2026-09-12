# Working on this Goribu app

Read `README.md` before changing setup or deployment. Keep the starter small;
add routes and dependencies only for actual application needs.

## Commands and ownership

- Use Node.js 22+ and pnpm. Run app commands from this directory.
- `pnpm dev` starts local development; `pnpm build` produces production output.
- `pnpm check` reads the production plan without changing resources.
- Deployment uses `pnpm run deploy`; bare `pnpm deploy` invokes pnpm's own
  command instead of the app script.
- The maintainer installs dependencies, commits, and deploys. Provide the exact
  command and wait for confirmation; do not perform these actions yourself.
- Preserve unrelated work. Never edit generated `dist/`, `.goribu/`, `.wrangler/`,
  or `node_modules/`, and do not commit credentials or local environment files.

## Application conventions

- Use ESM and JSX, following the language of the existing source files.
  `goribu.config.js` is Node-loadable data, not JSX.
- Routes live in `src/routes/`: `index.tsx` maps to `/`, `[id].tsx` to one dynamic
  segment. A default page without a handler has an implicit GET.
- Named handlers receive `(req, res)`. Return `res.render(props)` for the same
  route's page, or `res.json`, `res.text`, `res.redirect`, or `res.notFound`.
  Read input through `req.params`, `req.query`, and `await req.body()`.
- Put server-only helpers outside the routes directory in `.server.ts` files.
  Import them from handlers, never from browser-reachable page code.
- `goribu` contains shared UI APIs; `goribu/server` contains runtime/config APIs;
  `goribu/client` bootstraps the browser; `goribu/vite` is build-only.
- Keep `<Stylesheet />` and `{head}` in the Document head and `<ClientEntry />`
  after `#root`. The explicit client-entry URL is the development fallback;
  production resolves hashed assets. Preserve the request nonce.
- Use Goribu's `Link` and `Form` for hydrated navigation and form behavior.
  Static output and hydration are separate: static pages can be interactive.
- Global CSS is imported from `src/client-entry.js`. Tailwind belongs to this
  app's Vite configuration, not to the framework. Write complete class names.
- Only `PUBLIC_*` environment values are browser-visible. Never prefix secrets
  with `PUBLIC_` or serialize them into page props.
- `/_goribu/` is reserved. Do not create app routes or public files there.

## Data and validation

<!-- typescript-only:start -->
Run `pnpm typecheck` as well as `pnpm build`. Use type-only imports for
`Handler` and `Middleware` from `goribu/server`, and `DocumentProps` and `Meta`
from `goribu`. Validate request bodies at runtime before accessing their fields.

<!-- typescript-only:end -->

- Declare D1/KV only in `goribu.config.js`; Goribu generates their bindings.
  Use request-scoped `req.d1` and `req.kv` in server handlers.
- Use migrations for D1 schema and compatible expand/contract changes for live
  apps. Never imply a schema migration and Worker deployment are atomic.
- KV is eventually consistent, including cached misses. Use D1 when correctness
  requires fresh reads; never promise KV read-your-writes.
- Test the actual affected behavior. Before handing off, run the relevant checks
  and `pnpm build`; do not claim a command passed without observing it.

For deeper topics, consult the matching page in the
[Goribu guides](https://goribu-site.aggelos-gesoulis.workers.dev/docs): routing,
handlers, rendering, navigation/forms, metadata, D1/migrations, KV, or deployment.
