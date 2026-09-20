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
