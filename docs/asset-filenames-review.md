# Production CSS filename correction

Route-specific stylesheets exposed an encoded absolute build path in their
public filenames. The existing `client-route-[hash].js` rule protected JavaScript
chunks, but Vite derived extracted CSS names from the original chunk name rather
than the JavaScript filename. Global-only CSS in the earlier production fixture
did not exercise this case.

Goribu now names generated CSS `style-[hash].css` through the client build's
`assetFileNames` hook. This happens before Vite records emitted CSS references,
so HTML stylesheet links, browser loading, and the Worker asset manifest share
the final names. Non-CSS assets keep their existing naming pattern. There is no
new public API or app configuration step.

The regression builds a disposable copy of `fixtures/basic-app` with global
CSS, CSS imported by a static page, a CSS module imported by a Worker page, a
nested CSS import, and an emitted SVG referenced by CSS. Before the fix, it
failed on the encoded temporary build directory in the route CSS filenames.
After the fix, it checks filenames and public HTML/JS/CSS for that directory,
then serves the real production artifact through Wrangler. Both pages load
their own styles and shared styles, all referenced scripts and preloads resolve,
and the CSS image URL serves the expected bytes with content-hashed naming.

The focused asset/plugin/site checks passed **4 files / 22 tests**. Logs:
`/private/tmp/goribu-css-names-before.log` and
`/private/tmp/goribu-css-names-focused.log`. The initial sandboxed attempt could
not open Wrangler's local listener; the reproduction and passing checks ran
with local port access enabled.

The full `pnpm test --maxWorkers=1` passed **90 files / 698 tests** in
253.56 seconds. JavaScript syntax checks and `git diff --check` passed. Full
log: `/private/tmp/goribu-css-names-full.log`. No dependencies were installed,
and no commit, publication, or deployment was performed.

An already-deployed app needs the corrected framework followed by a rebuild
and maintainer deployment. This source change does not remove previously
uploaded assets. The reported external app has not been modified or redeployed.

Suggested commit: `fix: keep build paths out of CSS asset filenames`.

## Follow-up: lowercase content hashes

The asset guard incorrectly assumed an eight-character hash must contain a
digit or uppercase letter. Valid output such as `qhtdyqap` therefore failed
intermittently as the build's content changed. Removing that requirement alone
would also accept fixed names such as `client-fallback.js`.

The guard now checks bundler evidence. For JavaScript, the final filename must
match the chunk's preliminary filename with its hash placeholders replaced.
For CSS and images, Goribu records the sources passed through hashed naming
patterns and uses the bundler's asset deduplication and filename lookup to
recover their generated names during the final audit. This uses the original
source because Vite replaces CSS asset-URL placeholders after naming the CSS.
Naming-only probes leave no additional output. Chunk sourcemaps retain their
owning chunk's fingerprint. The existing eight-character hash contract remains.

The relevant bundler contracts are
[preliminary chunk filenames](https://rolldown.rs/reference/Interface.OutputChunk#preliminaryfilename)
and [asset emission, deduplication, and filename lookup](https://rolldown.rs/reference/Interface.PluginContext#emitfile).
This is build-only validation: it adds no dependency or browser/Worker code and
does not change the framework's filename patterns or cache headers.

Regression coverage includes the reported lowercase chunk token, a real
all-lowercase asset hash, changed content producing a changed asset URL, assets
emitted in a late `generateBundle` hook, sourcemaps, and rejection of fixed
chunk/asset names even when their suffixes look like hashes. The production CSS
fixture also exercises CSS URL replacement and image delivery.

Validation: **97 files / 745 tests** passed in the full workspace run. After a
final refinement to reuse naming patterns without recalling app callbacks and
to copy binary source bytes, **4 files / 23 focused tests** passed. A disposable
public-site copy also passed on Vite 8.3.0 / Cloudflare plugin 1.57.2: production
build, deployment dry run, development startup, local environment loading, and
the output-cleanup preservation regression. Evidence is in
`/private/tmp/goribu-hash-full.log`,
`/private/tmp/goribu-hash-final-focused.log`, and
`/private/tmp/goribu-hash-final-site.log`. Nothing installed or deployed.

## Follow-up: final naming hooks

A later `outputOptions` hook could replace the naming wrapper, leaving valid
hashed assets unrecorded. The regression reproduced that rejection. The tracker
now runs as a post output-plugin hook; immediately before the client build,
Goribu places it after the resolved app output plugins. It therefore wraps the
final string or function naming option. Existing plugin hooks remain intact,
and repeated builds do not accumulate tracker plugins.

The focused run passed **4 files / 25 tests**, including before/after hook
ordering, a late app output plugin, repeat builds, and fixed-name rejection.
The public-site compatibility probe passed on Vite 8.3.0 / Cloudflare plugin
1.57.2, including the production build, deployment dry run, development checks,
and cleanup preservation. The earlier full-suite result predates this follow-up.
Evidence: `/private/tmp/goribu-naming-order-before.log`,
`/private/tmp/goribu-naming-order-focused.log`, and
`/private/tmp/goribu-naming-order-site.log`. The appended decision explicitly
supersedes the historical entropy requirement without rewriting that decision.
