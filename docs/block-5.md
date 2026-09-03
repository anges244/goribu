# Block 5 - The client runtime

This block joins streamed server rendering to a real browser runtime. Every
route now hydrates from inert initial data, navigation and forms enhance their
native HTML only after bootstrap, and static response origin remains independent
from browser interactivity: the landing page is both a Static Asset and a
hydrated React page.

## What landed

- **A fail-closed client graph** - `src/client-entry.js` reaches the public
  `goribu/client` bootstrap, route pages are exposed through canonical-ID virtual
  modules, handler-only imports tree-shake away, and `.server.*` modules are
  rejected during resolution and audited again in emitted chunks.
- **Hydration from inert data** - the Document emits route ID and props as
  escaped `application/json` scripts, then one external module entry. The browser
  validates both payloads, loads the exact page module, hydrates the fixed
  `#root`, and installs navigation only after hydration succeeds.
- **Navigation** - `<Link>`, `<NavLink>`, and `navigate()` share one controller
  with an explicit `/_goribu/worker-nav` protocol, lazy pages, redirects,
  full-document fallback, bounded intent prefetch, history, fragments, scroll
  restoration, and stale-navigation protection.
- **Forms** - `<Form>` supports native GET and POST, enhanced query navigation,
  negotiated JSON/invalid/redirect/render outcomes, same-page render safety,
  file-aware encoding, pending/data/error state, validation focus, duplicate
  submission protection, and defined pre-hydration behavior.
- **Production client assets** - the client environment builds before Workers;
  its hashed entry, page chunks, module preloads, and CSS are captured in a
  virtual module consumed by Worker rendering and build-time static output.
  Missing production capture fails the build instead of falling back to a source
  URL.
- **Metadata and Document policy** - route `meta` objects/functions produce a
  strictly validated managed head set; custom Documents receive
  `{ children, head, nonce }` and place zero-prop `<Stylesheet />` plus
  `<ClientEntry>`.
- **Worker response policy** - callback-only `responseHeaders` receives the
  original request, env, mode, and a per-request nonce. Unsafe blanket headers
  fail, route headers win, and protocol-owned representation headers cannot be
  reintroduced.
- **Public browser environment** - Vite exposes only mode-aware `PUBLIC_*`
  values. Initial config and final resolved config are both checked so an author
  or later plugin cannot broaden the prefix.
- **The site as proof** - the static landing route has a real hydrated disclosure
  and hashed client graph; `/feedback` exercises invalid, same-page render, cookie,
  and redirect outcomes; every route exports managed metadata; dynamic responses
  use nonce-coupled CSP.
- **Docs** - `docs/navigation.md`, `docs/forms.md`, `docs/metadata.md`, this
  writeup, matching site pages, and a changelog entry.

## What emerged

- **Production hydration was not already wired.** The v2 mapping described the
  asset resolver as nearly complete, but no build captured a client manifest or
  handed it to the Worker. Until that integration landed, production Documents
  referenced `/src/client-entry.js`, which did not exist in output. v3 now owns
  client-before-Worker ordering and fails closed if it changes.
- **Forms required a native contract correction.** v2 described PUT/PATCH/DELETE
  forms and blanket HTML fallback. The actual browser baseline supports GET and
  POST, so Goribu now exposes only those methods; before hydration, each handler
  result keeps its ordinary representation rather than inventing an enhanced
  validation state.
- **Static output and request nonces conflict by definition.** A reusable Static
  Asset cannot carry a per-request nonce. Structurally static candidates omit the
  nonce, retaining deterministic byte-identical output, while Worker-owned
  documents share one fresh value across CSP and every script.
- **Development CSS follows v3's active Vite graph.** v2 served a separate
  watched aggregate stylesheet. v3 already has Vite transforming the browser
  graph, so `<Stylesheet />` emits production manifest CSS and development lets
  Vite inject imports directly.
- **Worker response policy does not reach Static Assets.** A callback that needs
  request, env, and nonce cannot execute when the Worker is bypassed. Static CSP
  and app-defined static headers remain an explicit residual rather than being
  implied by the dynamic site policy.

## Non-obvious choices

- **Protocol responses carry a private identity mark.** A `WeakSet` lets global
  defaults recognize navigation/form envelopes without exposing a forgeable
  public flag. The mark survives response reconstruction for `Vary` handling.
- **Metadata is data, not React nodes.** One strict object schema supports common
  semantic fields plus ordered meta/link descriptors. This keeps server and
  browser rendering identical and makes unsafe or ambiguous input fail before
  streaming.
- **There is one managed title.** Missing route title means an empty title, not a
  Document fallback that could become stale after navigation.
- **No route-level hydration opt-out yet.** Every route hydrates. Static describes
  request execution only, and a future HTML-only mode must remain a separate
  browser-axis decision.
- **No runtime environment serialization.** `PUBLIC_*` values are Vite build
  inputs. Worker bindings and secrets remain on `req.env` and cannot cross into
  browser code by widening `envPrefix`.

## Verification - the "Done when"

The automated floor is green: 54 test files and 439 tests, including real Vite
production/development transforms, a production site build, static HTML asset
inspection, and dynamic workerd rendering.

The block still requires maintainer-run deployment and live browser verification
before it is closed. Against the deployed site, verify:

1. The landing disclosure hydrates while `/` remains served from Static Assets.
2. Docs `<Link>` navigation changes routes without a full document load.
3. `/feedback` shows validation and preview in place, then redirects after send,
   without a full document load.
4. Dynamic `/feedback` carries one request-specific CSP nonce shared by all three
   script elements; static pages remain nonce-free and are not claimed to receive
   the Worker CSP policy.
5. Browser back/forward, active navigation, metadata/title replacement, and
   scroll restoration remain coherent.

## Lesson log

1. **The mapping overstated production asset readiness.** Diagnosing the real
   build boundary turned a nominal copy into manifest capture, environment
   ordering, Worker wiring, and integration tests. **Framework change.**
2. **Production had never hydrated before the asset work.** Static and dynamic
   HTML both carried a development-only source URL. The first real production
   integration exposed it and now guards against regression. **Framework fix.**
3. **Native form semantics narrowed the public API.** GET/POST and ordinary
   pre-hydration representations replace v2's broader claim. **Deliberate v3
   divergence**, recorded as a decision.
4. **Nonce introduction broke the static-byte invariant on the first full-suite
   run.** Static candidates now omit HTML nonces; Worker-owned documents retain
   request coupling. **Framework correction**, with build/workerd coverage.
5. **Graph CSS had a different development owner.** Porting v2's separate server
   would have duplicated Vite. The helper was adapted to v3's actual pipeline.
   **Deliberate adaptation**, recorded as a decision.
6. **Docs front matter initially crossed the strict metadata boundary wholesale.**
   Routes now project only title and description, so future navigation fields do
   not become render failures. **Site hardening.**

## Known residuals

- **Application-defined static response headers are unsupported.**
  `responseHeaders` is Worker-only and `public/_headers` remains reserved until a
  parser, merge precedence, and immutable-namespace protection are designed.
- **No route-level HTML-only mode.** Every route hydrates; the opt-out remains
  post-gate.
- **No React Fast Refresh guarantee.** Development uses Vite's live graph and
  ordinary module/CSS updates, but state-preserving refresh is not a public
  framework contract.
- **Public runtime types remain post-gate.** Runtime behavior is documented and
  tested in plain JavaScript; hand-written declarations arrive at the planned
  type gate.
