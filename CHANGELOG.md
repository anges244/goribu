# Changelog

All notable changes to Goribu are recorded here. This file is maintained as
changes land, not retrofitted at release time.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
Goribu follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
`goribu` and `create-goribu` share one version and publish to `latest`.

## [Unreleased]

### Added

- `<Form>` supports real PUT, PATCH, and DELETE requests to matching route handlers, with the same state and response handling as POST. Extended-method forms wait for hydration; native GET/POST submission and their button method overrides remain supported.
- Public declarations for all four package entries, including typed handlers,
  metadata, forms, cookies, D1, and KV. Strict fixtures check valid and invalid
  usage, module resolution, and runtime/declaration export parity.
- A canonical TypeScript/Tailwind starter with `pnpm typecheck`. Packaging
  derives the JavaScript variant without TypeScript configuration or dependencies.

### Changed

- `create-goribu <name>` defaults to TypeScript. Use `--js` for JavaScript.
  Both languages retain the existing JavaScript config and browser entry names.

### Fixed

- Pages with non-GET handlers stay on the Worker so Static Assets cannot shadow form submissions with 405 responses. Explicit `prerender = true` rejects these routes with a repair instruction.
- Scaffolder errors identify unknown options, duplicate flags, missing values,
  invalid names, archive failures, existing targets, permissions, and package
  defects separately, with repair instructions. Names ending in a hyphen are
  rejected before generating an invalid Worker configuration.
- Local archive readability checks avoid loading the entire tarball into memory.
- JavaScript starter docs preserve shared prose mentioning TypeScript. Invalid
  starter manifests fail packaging with specific repair instructions.

## [0.7.2] - 2026-09-07

### Fixed

- Both npm packages point their repository, issue tracker, and README source
  links to `anges244/goribu` after the GitHub repository rename.

## [0.7.1] - 2026-09-07

### Fixed

- Development pages load their imported styles before first paint through the
  existing `<Stylesheet />` helper. Initial CSS uses Vite's live transforms and
  yields to injected styles after client loading, preserving CSS hot updates
  without stale rules. Production asset delivery is unchanged.

## [0.7.0] - 2026-09-06

### Added

- One maintainer-run `pnpm release` command with prepare, pack, and publish
  stages: shared version changes, full-suite and archive validation, saved
  artifact hashes, ordered publication to latest, and verified retry after
  partial publication. The first replacement retires the old alpha tag only
  after both packages succeed.
- Release preparation for the shared `0.7.0` version: public npm metadata,
  package READMEs, and a template packaging guard that rejects mismatched or
  prerelease versions.
- Minimal independent bill-splitter app at `examples/goribu-split`, generated
  from the canonical starter, with exact-cent arithmetic, accessible input
  validation, and two static hydrated pages. It requires no data resources.
- Getting-started guide for the unpublished rebuild's real local-package path,
  from scaffolding through browser checks and production deployment. The site
  keeps its existing getting-started URL and links to it from the homepage.
- `create-goribu` scaffolder: generates the canonical
  JavaScript/Tailwind starter from a self-contained packed template, assigns app
  identity and pnpm build permissions, and refuses to overwrite existing targets.
  Generated apps pin the matching framework release, with an explicit local
  tarball override for unpublished changes. No automatic install, Git
  initialization, or deployment is performed.
- In-repository JavaScript starter with app-owned Tailwind, a hydrated static
  home page, a request-time greeting, app-specific agent instructions, and
  optional one-line D1/KV declarations.
- Deploy authentication preflight — validates Wrangler credentials and account
  selection before building, including apps without D1/KV. Both provisioners
  reuse the result; standalone builds remain authentication-free. Failure teaches
  explicit login or token setup instead of waiting until after the build.
- Zero-config KV — one `kv: { name }` declaration, read-only production
  inspection, namespace creation/reuse, and generated local/production `KV`
  bindings alongside D1. Deploy attaches both bindings before D1 migrations and
  Worker upload.
- Request-scoped KV — lazy `req.kv.get`, `put`, `list`, and `delete`, native
  values, TTLs, metadata, and cursor pages with actionable missing-binding errors.
  The site caches a public community-feedback snapshot from D1; KV's eventual
  consistency and the absence of a read-your-writes guarantee are documented.
- Zero-config D1 — declare one database in `goribu.config.js`; `goribu check`
  reads the production plan without mutation, `goribu deploy` creates or
  reconciles the database and synthesizes the `DB` binding, and development uses
  a matching local database without an author-owned Wrangler file.
- Request-scoped D1 — lazy `req.d1` tagged queries, terminal result methods,
  atomic batches, normalized failures, primary/public freshness modes, and
  replica bookmark cookies that carry read-your-writes across redirects.
- D1 migrations — one numbered SQL shape and tracking table, local-by-default
  `migrate`, `migrate:new`, `migrate:status`, one-step `migrate:down`, and
  local-only `migrate:seed`; production status is included in `goribu check`,
  deploy applies pending files before Worker upload, drift fails closed for
  mutations, and per-file SQL is batched with its ledger change.
- Client hydration — every route ships an audited browser graph, hydrates the
  fixed `#root` from escaped inert route/props data, and resolves production
  entries, route chunks, module preloads, and CSS by content-hashed manifest.
- Client navigation — `<Link>`, `<NavLink>`, and `navigate()` use a reserved
  Worker protocol with lazy route modules, intent prefetch, history and scroll
  restoration, metadata synchronization, and full-document fallback.
- Enhanced forms — `<Form>` provides native GET/POST fallback plus hydrated
  pending/data/error state, validation focus, JSON/invalid/redirect/same-page
  render outcomes, file-aware encoding, and stale/duplicate submission guards.
- Route metadata and Document helpers — strict route-owned `meta`, managed head
  replacement, `Document({ children, head, nonce })`, `<Stylesheet />`, and
  `<ClientEntry>` with request-coupled nonce support on Worker renders.
- Global Worker response policy — callback-only `responseHeaders({ request, env,
  mode, nonce })`, with unsafe blanket-header rejection and protected navigation
  and form representations. Static Assets do not receive this policy.
- Public browser environment — only mode-aware `PUBLIC_*` values enter
  `import.meta.env`; custom Vite prefixes that could expose secrets fail closed.
- Route handlers — a route can export named HTTP method functions (`GET`, `POST`,
  …) that run instead of rendering. Each handler receives a request surface
  (`req.method`, `req.path`, `req.params`, `req.query`, `req.headers`,
  content-type-aware `req.body()` and raw `req.rawBody()`) and a response builder
  (`res.text`, `res.json`, `res.redirect` — `303` by default, `res.render`,
  `res.notFound`, chained `res.status`/`res.headers`). A route may export a page,
  handlers, or both.
- Cookies — `req.cookies` reads incoming cookies and queues outgoing ones
  (`get`/`set`/`delete`), flushed as `Set-Cookie` on the final response. No
  security defaults are assumed.
- Folder-scoped middleware — a `_middleware` file applies to its directory and
  everything beneath it, running outermost-first (a default function or a flat
  array) with no `next`: return nothing to continue, or a `res.*` result to stop.
  A route with middleware is served by the Worker rather than statically output.
- Error boundaries — a thrown request is caught at the edge: development discloses
  the error, production renders an optional `src/routes/_500.jsx` with a logged
  correlation ID and no raw detail. A malformed request body is answered with a
  safe `400`, not a `500`.
- Worker bindings and background work — the app is invoked as
  `fetch(request, env, ctx)`; routes receive `req.env` (the raw bindings) and a
  bound `req.waitUntil`, while the execution context stays private.
- Server-only module boundary — files named `*.server.*` may be imported by route
  handlers but are kept out of the client bundle, enforced by a build-time guard
  and a fail-closed bundle audit.
- Documentation site — the framework's docs are now a live Goribu app: a landing
  page and a guided-tour docs set (getting started, the CLI, routing, rendering,
  static routes, the JavaScript position, and deploying). Markdown is compiled to
  React components at build time by the site's own Vite plugin; the framework
  itself is unchanged. Live at
  https://goribu-site.aggelos-gesoulis.workers.dev.

- `goribu` CLI, the framework's front door, with `dev`, `build`, and `deploy`
  commands.
- `goribu dev`: local development server (Vite plus workerd) serving the real
  Worker with HMR.
- `goribu build`: one production build emitting the Worker bundle and the client
  bundle.
- `goribu deploy`: deploy to Cloudflare (Worker plus static assets).
- `defineConfig()` from `goribu/server`: the application configuration channel,
  starting with the deploy fields `name`, `compatibilityDate`, and
  `compatibilityFlags`.
- Streaming server-side rendering of a React page through
  `renderToReadableStream`.
- Wrangler configuration synthesized from `goribu.config.js`, so an app never
  hand-writes a Wrangler file.
- File-based routing: files under `src/routes/` map to URLs, with `[param]`
  dynamic segments, static-before-dynamic precedence, and build-time errors for
  conflicting routes. Catch-all and optional segments are deliberately not
  supported yet.
- Streaming server-side rendering for every matched route through a document
  shell, with a customizable `src/routes/_document.jsx` and a built-in default.
- `_404`: a custom or built-in not-found page, rendered with a `404` status.
- Automatic method responses from routing alone — `HEAD`, `OPTIONS` (`204`), and
  `405 Method Not Allowed`, each with an `Allow` header.
- Trailing-slash canonicalization: a single `308` redirect to the slash-free
  URL, applied consistently to static and dynamic routes.
- Static asset serving from `public/` via the `ASSETS` binding, with a generated
  `_headers` caching Goribu's fingerprinted client build (`/_goribu/assets/*`)
  immutably.
- Build-time static output: routes whose first response needs no Worker are
  rendered at build time by running the emitted Worker in workerd, and served
  from Static Assets without invoking the Worker. Candidates that cannot be made
  static are downgraded with a named reason.

### Fixed

- Cold development starts of independently installed apps prebundle Goribu and
  React together, preventing late lazy-page dependency discovery from reloading
  the browser with mismatched React instances.
