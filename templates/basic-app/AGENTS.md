# Working on this Goribu app

Read `README.md` before changing setup or deployment. Keep the starter small;
add routes and dependencies only for actual application needs.

## Commands and ownership

- Use Node.js 22+ and pnpm. Run app commands from this directory.
- `pnpm dev` starts local development; `pnpm build` produces production output.
  `pnpm dev --port <number>` listens on exactly that port for one run and fails
  if it is taken; `pnpm dev --host` opens the dev server to the local network.
- Production HTML/assets live in `.goribu/dist/client/`; the Worker and its
  deploy configuration live in `.goribu/dist/<worker-environment>/`.
- `pnpm check` reads the production plan without changing resources.
- Deployment uses `pnpm run deploy`; bare `pnpm deploy` invokes pnpm's own
  command instead of the app script.
- The maintainer installs dependencies, commits, and deploys. Provide the exact
  command and wait for confirmation; do not perform these actions yourself.
- Preserve unrelated work. Never edit generated `goribu.wrangler.jsonc`, `.goribu/`, `.wrangler/`,
  or `node_modules/`, and do not commit credentials or local environment files.

## Application conventions

- Use ESM and JSX, following the language of the existing source files.
  `goribu.config.js` is Node-loadable data, not JSX.
- Routes live in `src/routes/`: `index.tsx` maps to `/`, `[id].tsx` to one dynamic
  segment. A default page without a handler has an implicit GET.
- Named handlers receive `(req, res)`. Return `res.render(props)` for the same
  route's page, or `res.json`, `res.text`, `res.redirect`, or `res.notFound`.
  Read input through `req.params`, `req.query`, and `await req.body()`.
  Form bodies are objects: uploads are `File` values and repeated fields are
  arrays. Validate field values; do not branch on `FormData`.
- Put server-only helpers outside the routes directory in `.server.ts` files.
  Import them from handlers, never from browser-reachable page code.
- `goribu` contains shared UI APIs; `goribu/server` contains runtime/config APIs;
  `goribu/client` bootstraps the browser; `goribu/vite` is build-only.
- App setup lives in `src/setup/`: required `client-entry.js` and optional
  `_document`. Global CSS starts at `src/styles/global.css`.
- Keep `<Stylesheet />` and `{head}` in the Document head and `<ClientEntry />`
  after `#root`. The explicit client-entry URL is the development fallback;
  production resolves hashed assets. Preserve the request nonce.
- Use Goribu's `Link` for hydrated navigation. Goribu's interactive features
  deliberately require JavaScript. Use `<Form>` with `get`, `post`, `put`,
  `patch`, or `delete` and the corresponding named handler. Do not avoid mutation
  methods or colocated handlers solely for progressive enhancement.
- Colocate handlers with their page when appropriate. To keep an otherwise
  static page prerendered, put its mutation handler in a separate route without
  a page component and target it with `<Form action="/action-path">`. Adding a
  mutation handler to the page makes that route dynamic; forcing
  `prerender = true` is invalid.
- In production, prerendered pages use Static Assets for document loads, client
  navigation, and prefetch. Their props and metadata stay fixed at build time,
  including explicitly prerendered GET handlers; query changes do not rerun
  them. Use `prerender = false` for request-dependent output. Development uses
  the Worker.
- For Form mutations, prefer `res.json(data)` for an in-place result,
  `res.invalid(errors)` for field errors, or `res.redirect(url)` for navigation.
  Use `res.render(props)` only for intentional rendering of the handler's own
  page; a separate action cannot use it to replace the submitting page at
  another pathname.
- Render field errors and `errors.root`; `res.invalid("message")` sets the
  form-level error.
- Global CSS is imported from `src/setup/client-entry.js`. Tailwind belongs to this
  app's Vite configuration, not to the framework. Write complete class names.
- Only `PUBLIC_*` environment values are browser-visible. Never prefix secrets
  with `PUBLIC_` or serialize them into page props.
- `/_goribu/` is reserved. Do not create app routes or public files there.

## Code readability

- Follow nearby style, using blank lines between logical groups and declarations;
  keep related statements together.
- Prefer descriptive names and readable multiline code over compressed expressions
  or JSX. Comment on intent and non-obvious choices.
- Keep formatting changes local to the code you touch.

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
[Goribu guides](https://goribu.dev/docs): routing,
handlers, rendering, navigation/forms, metadata, D1/migrations, KV, or deployment.
