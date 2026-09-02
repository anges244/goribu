# Block 4 — The request surface

Apps stop being documents and start being programs. Everything here is
server-side; the browser half is the next block. A route gains named HTTP
handlers, a request surface and a response builder, cookies, folder-scoped
middleware, a two-mode error boundary, Worker bindings, and a server-only module
boundary — the whole vocabulary a request needs before there is any client
runtime to talk to.

Unlike Block 3, this block **changed framework source** — but by porting the
previous version one piece at a time, each arriving, running, and being seen
work on its own before the next. Two of those pieces revealed real gaps that the
plan had not: this writeup records both.

## What landed

- **Named method handlers** — a route file may export `GET`, `POST`, and so on.
  The dispatcher runs the matched method's handler instead of rendering, and a
  route may export a page, handlers, or both. `create-response.js` (the response
  builder) was ported whole; `create-app.js` learned to dispatch and finalize.
- **The request surface** — `createRequest` gives a handler `method`, `path`,
  `params`, `query`, `headers`, a content-type-aware `body()` and a cached
  `rawBody()`, all behind one lazy read so the stream can't be consumed twice.
- **Response intents** — `res.text/json/redirect/render/notFound`, with chained
  `status`/`headers`. Handler-returned `render` and `notFound` stream the route's
  own page through the same document shell an implicit GET uses. There is no
  `res.html` — HTML from a handler is a rendered page.
- **Cookie transport** — the four transport modules ported verbatim, exposed to
  routes as `req.cookies` and flushed as `Set-Cookie` on the final response.
- **Folder-scoped middleware** — `_middleware` files, selected outermost-first at
  build time, composed with no `next`. Middleware shares one `req`/`res` with the
  route and can short-circuit with any `res.*` result.
- **Error boundaries** — a development finalizer (ported verbatim) that discloses,
  and a production finalizer that renders `_500` with a logged correlation ID.
  Branded `HttpError`s map to their 4xx in both modes.
- **Worker runtime contract** — `fetch(request, env, ctx)`, with `req.env` and a
  bound `req.waitUntil` route-facing and `ctx` private.
- **Server-only boundary** — a client-environment Vite plugin that rejects
  `.server.*` imports from browser code and audits the client bundle.
- **Docs** — `docs/handlers.md`, `docs/middleware.md`, `docs/errors.md`, this
  writeup, and a changelog entry.

## What emerged

- **goribu3's `create-app.js` was a reduced Block-2 rewrite, not v2's dispatch
  chain.** The v2-to-v3 mapping called Block 4 "copy wholesale"; in fact the
  runtime had to be a port-with-adaptation onto goribu3's flatter boundary. The
  leaf modules (response builder, request surface, cookies, the dev error
  finalizer, the middleware primitives) ported verbatim; the wiring that composes
  them was rebuilt to fit.
- **Middleware collides with static output.** A route with middleware runs code
  per request, so it cannot be served from Static Assets — but the static planner
  decided eligibility from the manifest alone and would have prerendered it,
  silently dropping the middleware in production. Caught before shipping; fixed by
  making any route with selected middleware Worker-only, sharing one build-time
  middleware-selection helper between Worker generation and static planning so the
  two can never disagree.
- **The `.server.*` boundary has no client-side target yet.** Its real job —
  keeping server-only code out of route pages that ship to the browser — waits for
  Block 5's hydration. Block 4 ships and tests the convention and the enforcement
  mechanism against the current client graph; the guard is in place before the
  code it guards arrives.

## Non-obvious choices

- **The response builder was ported whole, carrying inert branches.** `res.invalid`
  and the form-render context ride along unused until forms land in Block 5. The
  leaf was kept byte-identical rather than trimmed and later restored.
- **`HttpError` is branded by a private `WeakSet`, not a Symbol property.** This
  supersedes the byte-identical port: the error boundary must classify arbitrary
  thrown values, and a hostile `Proxy` whose `get` trap throws could make a
  property read (`value[HTTP_ERROR]`) throw during classification and escape the
  boundary. A `WeakSet` identity check reads nothing off the value.
- **`.server.*` modules live outside `src/routes/`.** The route scanner reserves
  only the `_` prefix, so a `.server.*` file under `src/routes/` is treated as a
  route and fails analysis — exactly as in v2, which never route-scans its
  `.server.*` files. Colocating them beside routes is a future routing decision,
  not part of this boundary.
- **`ctx` stays private.** Only `req.env` and a bound `req.waitUntil` reach routes;
  the raw execution context and `passThroughOnException` are not public surface.

## Verification — the "Done when"

Block 4 is done when, against a deployed app, the site has a route that accepts a
POST and redirects, middleware runs in the documented order, and both error
boundaries render correctly. The runbook for that verification is
`workspace/TEST_BLOCK_4.md`; the automated floor is the full suite, green.

## Lesson log

Points where building this block fell out of the happy path, and whether each
forced a change beyond a straight port.

1. **The runtime was not v2's.** goribu3's `create-app.js` failed closed on
   handlers where v2 dispatched. Block 4 was therefore a port-with-adaptation, not
   a copy — recognized in substep 1 and applied consistently after.
2. **Middleware could be silently bypassed by static output.** A real production
   correctness gap the plan missed; stopped per the rules and fixed with a shared
   selection helper and a Worker-only downgrade (with a `prerender = true` +
   middleware build failure). **Framework change**, recorded as a decision.
3. **A hostile thrown value could escape the error boundary.** Discovered while
   hardening the boundary; fixed by re-branding `HttpError` with a `WeakSet`.
   **Framework change** (diverging from v2), recorded as a decision.
4. **A colocated `.server.*` fixture broke route analysis.** The route scanner
   treats every supported file under `src/routes/` as a route. Rather than expand
   the substep into routing conventions, the fixture module moved outside the route
   tree — matching v2 — and the limitation was written down. **No framework
   change**; a future decision named.
5. **Path containment broke across symlinks.** The `.server.*` route-importer
   exception compared a non-realpath `routesDir` against a realpath-resolved
   importer, so on symlinked project roots (macOS `/tmp`, some CI) a route's own
   `.server.*` import was wrongly rejected — and the test masked it on
   non-symlinked machines. Fixed by realpath-normalizing both sides and making the
   regression build through an explicit symlink. **Framework change** (a bug fix in
   the same substep).

Net: this block changed framework source, as planned, and two unplanned
production-correctness gaps (middleware/static bypass, symlink containment) plus
one security hardening (the `WeakSet` brand) were caught and fixed within their
owning substeps — no debt carried across a substep boundary.

## Known residuals

- **`res.invalid` and enhanced form rendering are inert.** Carried in the ported
  response builder, they light up with `<Form>` in Block 5.
- **The `.server.*` guard has no route-page target yet.** Its bite lands when
  Block 5 puts route code in the client graph; the mechanism is already in place.
- **Colocated `.server.*` modules are not supported.** They live outside
  `src/routes/` until a route-discovery decision reserves the suffix.
- **Custom Worker bindings are pass-through only.** `req.env` hands over the raw
  bindings; request-scoped data ergonomics (D1, and friends) are Block 6.
