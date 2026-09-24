# Static client navigation review

Implemented locally on 2026-09-24. Ready for maintainer review and deployment;
no live deployment or public verification is claimed.

## Result

Production client navigation and prefetch to successfully prerendered pages use
Static Assets without executing the Worker. This covers Link, NavLink,
imperative navigation, GET form navigation, redirects into static pages, and
back/forward traversal through the existing navigation controller. Dynamic
routes continue through the Worker protocol.

An ordinary click on the exact current static URL scrolls to the top without
requesting route data, rerendering, or resetting component state. The dynamic
equivalent requests fresh data, ignoring prefetched data, and replaces the
history entry. Fragment links, including an empty `#`, remain browser-owned.
Development uses Worker navigation because there are no production snapshots.

## Implementation and rationale

- The client bundle, captured Worker asset manifest, and draft navigation index
  share an opaque build identity. The relevant Vite plugins are shared across
  build environments; otherwise Vite's separate configuration evaluation could
  produce different identities for the browser and Worker.
- Prerendering reads Goribu's escaped inert route/props scripts from each
  completed HTML response. Route data now also carries normalized metadata,
  status, and build identity. This captures the actual HTML render's props and
  metadata without executing the handler again. The extraction recognizes the
  framework's own serialization and refuses missing or duplicate reserved IDs;
  it does not attempt to interpret application HTML as navigation data.
- Each saved payload lives at
  `/_goribu/navigation/<build-id>/<sha256-of-payload>.json`. Both identity and
  content hash participate in its URL. These assets receive immutable caching.
  Bundler plugins cannot write into this prerender-owned namespace.
- `/_goribu/navigation.json` contains only successful routes and their payload
  locations. Prerendering finalizes it after output completes; the unfinished
  bundle's index has `routes: null` and cannot authorize static navigation.
  Even an all-dynamic build emits a valid empty index.
- Bootstrap fetches the index once with no-store caching. The controller checks
  its build identity, canonical paths, route loaders, and reserved asset URLs.
  Static payloads must match the expected build, route, successful render status,
  and existing navigation/metadata schema. A transient discovery failure can be
  retried. Dynamic navigation responses carry the Worker build identity too.
- Navigation retains the existing lazy page loading, CSS, metadata, history,
  scroll, stale-work invalidation, and document fallback. Initial HTML/browser
  mismatches reload before hydration; invalid or incompatible navigation data
  triggers a document load before committing page state.
- Cookie-setting and non-HTML responses cannot become public snapshots.
  Automatic candidates downgrade; forced prerenders fail. Missing or malformed
  hydration data fails the build with a repair message.

The index adds one small asset request per document bootstrap, including on
dynamic initial pages. Moving to another static page still loads its data and
missing JavaScript/CSS. The guarantee concerns Worker execution, not zero network
traffic. Previously downloaded snapshots can remain usable in an open tab;
missing assets or incompatible newly fetched data cause a document load.

## Deliberate behavior changes

Explicitly prerendered GET handlers and metadata functions now use their saved
build-time result for client navigation, matching static document loads. Query
strings remain in the URL but do not recompute those server results. Applications
that require request-dependent props or metadata must set `prerender = false`.
No new application configuration or Link option is required.

The navigation/static/metadata guides and their site copies, package README,
site landing explanation, changelog, and decisions log describe these semantics.
The fixture's navigation now uses Link so it exposes the behavior directly. The
generated asset manifest's optional build-identity field is synchronized in the
server declaration and public type fixture.

## Validation

- Full `pnpm test --maxWorkers=1`: **93 files / 713 tests passed**, 278.38 seconds.
  Log: `/private/tmp/goribu-static-navigation-full.log`.
- Final focused follow-up after the empty-fragment edge case, cookie/non-HTML
  regression, and declaration update: **5 files / 45 tests passed**. This covers
  Link, navigation controller, prerender orchestration, snapshot extraction, and
  public types. Log: `/private/tmp/goribu-static-navigation-final-focused.log`.
- New production integration builds a disposable copy of the fixture. A forced
  GET prerender produces a random token; HTML and JSON share exactly that token,
  while a subsequent direct Worker execution produces another. A Worker-only
  response marker is absent from the static index, payloads, and HTML, and
  present on dynamic requests. The real controller exercises asset prefetch,
  query navigation, same-page preservation, and static canonicalization.
- Regression checks exercise failed prerenders, escaped script-like props,
  malformed hydration data, incompatible manifests/payloads/Workers, missing
  assets, redirect/history behavior, stale navigation cancellation, immutable
  namespace protection, and fresh dynamic same-page data.
- Isolated headless Chrome with HTTP cache disabled verified a production copy
  of the actual site: static link transitions, hover prefetch, back navigation,
  route titles, and repeated NavLink scrolling all preserved one document and
  made no Worker navigation requests. Added probe pages verified exact saved
  props across query changes, static state preservation with no fetch, native
  fragments, fresh dynamic same-page data, no duplicate history, and return to
  the static snapshot. Zero browser errors were recorded. This browser run
  preceded the final empty-fragment correction, covered by the focused tests.
  The site's unrelated missing `/favicon.ico` request reached the Worker and is
  recorded separately rather than counted as a navigation failure.

Browser evidence: `/private/tmp/goribu-static-browser-w8gmeF/report.json` and
`build.log`. Probe: `/private/tmp/goribu-static-navigation-browser.mjs`.
All probe servers and Chrome sessions were closed.

The first build attempt was blocked by sandboxed local-port access; production
checks passed with that access. An initial direct command also found Node 18 in
the fixture shell; checks used the repository's Node 22. The first integration
run caught the Vite build-identity sharing issue, which was fixed before the
passing runs. Temporary browser-probe corrections covered favicon accounting
and selector quoting; they did not require framework changes.

## Maintainer handoff

Review found two regressions, now corrected. A Back navigation changes the
browser URL before rendering completes, so navigation chooses push/replace from
the actual URL and only takes the static scroll shortcut when the destination
also matches the displayed page. Regression tests cover clicking the displayed
static page during that pending traversal, explicit replace, and suppression of
the stale response. Snapshot extraction now requires HTML whitespace before
`id`, avoiding false duplicate detection for `data-id` and `data-route-id` while
still rejecting reused reserved IDs on other elements.

Both failures were reproduced before the fixes. The focused controller, Link,
snapshot, and prerender suites passed **4 files / 46 tests** afterward. The
production integration, now including those data attributes in its prerendered
page, passed **1 file / 2 tests**, including Worker-free static delivery. The
full-suite and Chrome results above precede these review corrections.

A documentation audit added the production no-Worker guarantee to repository
agent guidance and the build-time snapshot semantics to starter-app guidance.
Both navigation guides now explain pending history traversal, and the metadata
guide distinguishes request-time URLs from prerender URLs. The static-navigation
decision remains in the existing Markdown table. These documentation-only
follow-ups passed `git diff --check`; runtime tests were not repeated.

Suggested commit: `feat: serve static client navigation without Worker execution`.

After review, deploy the proving site from the repository root:

```sh
pnpm --dir site exec goribu deploy
```

Deployment is maintainer-owned. After confirmation, verify static links and
prefetch against the public site and check Worker invocations, including a
dynamic navigation as the positive control. Release preparation/publication is
a separate next action; no version bump, installation, commit, branch, or
deployment was performed here.
