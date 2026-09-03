# Changelog

All notable changes to Goribu are recorded here. This file is maintained as
changes land, not retrofitted at release time.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
Goribu follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The
first tagged release will be `0.1.0-alpha`; until then everything lives under
Unreleased.

## [Unreleased]

### Added

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
