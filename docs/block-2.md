# Block 2 — Routing and rendering

The pipeline gains a framework: many pages instead of one, and the build learns
which of them need a Worker at all. A multi-page site now goes from a scanned
route tree to a deploy where dynamic routes stream from the Worker and static
routes are served from the CDN without ever invoking it.

## What landed

- **File-based routing** — scan → analyze → manifest → match. Files under
  `src/routes/` become URLs, with `[param]` dynamic segments, static-before-dynamic
  precedence, and build-time errors for conflicting routes and duplicate parameter
  names. Catch-all and optional segments are a documented deliberate absence.
- **The reduced Worker runtime (`createApp`)** — matches each request, streams the
  matched page through the document shell, serves `_404`, and answers `HEAD`,
  `OPTIONS`, and `405` from routing alone. It fails closed on a route that exports
  a handler, whose request surface is Block 4.
- **Streamed SSR through a document shell** — `renderPage` streams
  `Document(children=Page)` via `renderToReadableStream`. A built-in default
  Document, overridable by a top-level `src/routes/_document.jsx`; `_404` custom or
  built-in, rendered with a `404` status.
- **Static asset serving** — `public/` served via the `ASSETS` binding; a generated
  `_headers` caches Goribu's fingerprinted client build (`/_goribu/assets/*`)
  immutably, guarded by a fail-closed audit that every file in that namespace is
  content-hashed.
- **Trailing-slash canonicalization** — the Worker `308`-redirects to the slash-free
  URL; static routes are canonicalized by the asset layer's matching
  `drop-trailing-slash` handling.
- **Build-time static output** — routes whose first response needs no Worker are
  rendered at build time by running the emitted Worker in workerd and asking it for
  each route, then written into the client asset directory. Candidates that cannot
  be static are downgraded with a named reason; an asset/route collision fails the
  build.
- **Docs** — `routing.md`, `rendering.md`, `static-routes.md`, three `decisions.md`
  rows, the changelog entries, and this writeup; `installation.md` corrected to the
  route tree.

## What emerged

- **The routing subsystem ported; the Worker runtime was rewritten reduced.** v2's
  `createApp` already carried handlers, middleware, and error boundaries — all
  Block 4 — so it could not be copied as-is. A reduced entry was written for this
  block that serves pages and the responses routing answers alone, and fails closed
  the moment a handler route appears.
- **Static output was genuinely new code.** The v2 tree had none — it was deferred
  to a never-built "P9". The eligibility rule was the only piece that ported.
- **The static-output mechanism took three iterations under review** before
  converging:
  1. *Import the built Worker bundle into Node* — rejected: a Worker bundle can carry
     `cloudflare:` imports that Node cannot load, and a single such route would
     poison the whole batch.
  2. *A scoped Node SSR bundle of only the static pages* — rejected: it does not
     reuse the app's real Vite pipeline (aliases, plugins, and Block 3's Markdown),
     it required widening the public `goribu/server` API, and syntactic eligibility
     never proved a page was Node-safe.
  3. *Run the emitted Worker artifact in workerd* via Wrangler's `createTestHarness`,
     fetching each route through the direct `getWorker()` handle. This is what
     shipped: the real artifact in its real runtime guarantees the static bytes equal
     what the Worker serves, reuses the app's own build, isolates each candidate so
     one failure downgrades alone, and needs no public API.
- **`unstable_dev` / `unstable_startWorker` are deprecated;** `createTestHarness` is
  the supported API and was already present in the pinned Wrangler.
- **Per-route failures are classified.** A rejected fetch is a harness failure and
  fails the build; a non-200 or a body that errors mid-stream is the route's own
  failure and downgrades it (or fails the build only if it forced `prerender = true`).

## Non-obvious choices

Recorded in full in [decisions.md](./decisions.md); the ones worth calling out:

- **Config is data; anything that renders is a file.** A custom Document is
  `src/routes/_document.jsx`, not a `goribu.config.js` field — Node loads the config
  directly and cannot import JSX, and a Document belongs in the render graph.
- **The two axes are kept apart.** "Static" is about request execution only; the
  browser axis is separate and every route hydrates (Block 5). Recording this now
  keeps "static" from drifting into "no JavaScript".
- **The asset/route collision guard.** Static Assets take precedence over the Worker,
  so a published HTML file at a route's URL would collide with static output or
  silently shadow a dynamic route. The build audits existing client HTML against the
  manifest and fails closed on either, with segment names percent-encoded so the
  check survives the matcher's decode step.

## Verification — the "Done when"

Live at **https://goribu-basic-app.aggelos-gesoulis.workers.dev**.

- The multi-page site builds and deploys: `/`, `/about`, `/posts/hello-world` all
  `200`, `/missing` a `404`.
- **Dynamic routes stream from the Worker.** `/posts/hello-world` carries the
  Worker's exact `Content-Type: text/html; charset=utf-8` and `308`-canonicalizes a
  trailing slash — both Worker behaviors.
- **Static routes are served without invoking the Worker — measured, not assumed.**
  `/` and `/about` carry the asset layer's headers (`text/html`, no charset; the
  asset `cache-control`), not the Worker's. A controlled burst of **40 static
  requests (`/`, `/about`) and 20 dynamic (`/posts/hello-world`)** added exactly
  **20** to the Worker's invocation count in that window (Cloudflare
  `workersInvocationsAdaptive`), not 60. The static routes cost zero Worker
  invocations.

## Known residuals

- **Hydration is Block 5.** Every route still ships the inert `src/client-entry.js`
  placeholder; nothing hydrates yet, and the client-boundary audit is later.
- **The request surface is Block 4.** Handlers, middleware, cookies, the request
  object, and the `_500` boundary — a route that exports a handler fails the build
  until then.
- **No route-level HTML-only opt-out.** Deliberately post-gate, so "static" never
  quietly means "no JavaScript".
- **`workspace/how-goribu-works.md`** (untracked) still describes the Block 1 tree;
  it is a private planning note, refreshed when it becomes misleading.
