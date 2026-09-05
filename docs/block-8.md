# Block 8 — Starting an app

Complete and live. The starter, local scaffolder, getting-started guide, and
independently generated second app all passed their recorded checks. The final
proof is https://goribu-split.aggelos-gesoulis.workers.dev: a small app created
through the documented path, customized without changing framework source, and
deployed by the maintainer. The original starter remains live at
https://goribu-starter.aggelos-gesoulis.workers.dev.

This closes the usability gate, not a public release. Both rebuild packages
remain unpublished; no package versions or release tags were changed.

## First substep — the in-repository starter

The canonical starter lives at `templates/basic-app/` alongside the framework.
It is separate from the behavioral fixture, whose regression routes are not
appropriate starter content. The maintainer chose an in-repository template
rather than a separate template repository.

The JavaScript app contains a Tailwind-styled static home page with a hydrated
counter and a Worker-rendered greeting that reads request input. Its custom
Document supplies language, viewport, route metadata, stylesheet delivery, and
the browser entry. D1 and KV are commented one-line opt-ins; neither is needed
to run the bare app. README and app-specific `AGENTS.md` cover the canonical
commands, runtime/build boundaries, resource semantics, and maintainer-owned
installation/deployment.

Tailwind belongs to the app's Vite config. Both Tailwind packages are pinned to
4.3.3; the Vite plugin's registry metadata declares Vite 8 support. The stylesheet
sets its scan base to this app's source directory so running inside a monorepo
does not scan unrelated apps. No framework code changed to add styling.

## Source assessment and lessons

- The v2 fixture is not a portable starter: it uses the retired Document config
  field, hand-authored Wrangler settings, and older build scripts. It contains
  no standalone template or Tailwind integration. The new starter uses the
  already-established Goribu 3 application contract; no v2 module was ported.
- The published predecessor does have a `create-goribu` package and a canonical
  TypeScript template with JavaScript transformation. Those are reference
  material, not justification to import the old runtime wiring or pull
  TypeScript support forward.
- The template uses `workspace:*` during development to select this unpublished
  rebuild rather than the older npm release. That is intentionally not yet an
  independent install path. Before completing this substep, a separate copy must
  install a packed framework package and work without workspace dependency links.
- Tailwind is retained by explicit maintainer choice. A second plain-CSS variant
  and styling-selection questions were not added.
- TypeScript remains post-gate. Its future work now explicitly includes one
  canonical TS template, generated JS, and independent verification of both.
- A compatibility date chosen from the maintainer's local calendar was still
  in the future in UTC and Miniflare rejected it. The starter now uses the
  already-proven `2026-08-31` date from the site and fixture.
- A production test must explicitly select `NODE_ENV=production`; otherwise
  its child build inherits the test runner's environment and can bundle React's
  development runtime. The starter integration build now selects production.
- Building the starter in place while its dev server was running caused watcher
  restarts as generated files changed. The integration test now builds a
  disposable source copy, reusing installed dependencies without touching the
  app's generated files or local resource data. This reuse is not presented as
  independent-install proof.
- An independently installed framework is prebundled by Vite, unlike a linked
  workspace package. The first browser load discovered the lazy pages' React
  imports after the bootstrap was optimized, reloaded, and produced an invalid
  hook call; a warm retry hid the problem. The framework now includes its shared
  and browser entries, React, React DOM's browser entry, and both JSX runtimes in
  the client's initial dependency optimization. Production and Worker settings
  are unchanged. This fixes the owning client-build boundary rather than asking
  each starter app to carry a Vite workaround.
- `pnpm deploy` invokes pnpm's own workspace deployment command, not an app
  script, and failed before running Goribu. The starter README and agent
  instructions now say `pnpm run deploy`; that exact path deployed successfully.

## Validation

All six starter JavaScript/JSX files and its package manifest passed parsing;
the new integration test passed `node --check`, and `git diff --check` passed.
These checks establish source syntax only, not runtime compatibility.

After the maintainer installed dependencies, the focused production check passed
both tests: it verifies compiled Tailwind and hashed static browser assets, then
exercises request-specific rendering and escaping through the emitted Worker
without D1/KV. The full `pnpm test` run passed **80 files and 627 tests**. After
isolating the starter build from its dev server, the focused test passed again
with **2 tests**. `git diff --check` passed.

The actual `pnpm --dir templates/basic-app dev` server returned HTTP 200 for the
home page, greeting, and generated Tailwind stylesheet. A separate headless
Chrome profile confirmed the counter increments after hydration, Tailwind sets
the heading to 36px, and navigation to the Worker greeting and back preserves
the document without browser exceptions. The dev server and browser were
stopped after verification.

`pnpm --dir templates/basic-app check` passed with no declared resources or
migrations, and no changes made. The framework was packed locally as
`goribu-0.0.0.tgz`, and a separate temporary app was prepared with that tarball
dependency and its own pnpm workspace/build-script permissions. Its dependency
installation was performed by the maintainer. The independent app passed build
and check; module-resolution checks confirmed that Goribu, React, Vite, and
Tailwind all resolve inside its own installation, without workspace links. Its
emitted Worker served the static home page, compiled stylesheet, and dynamic
greeting successfully. A read-only Wrangler lookup confirmed that the intended
`goribu-starter` Worker did not yet exist; nothing was deployed.

The cold-start browser failure described above reproduced in that installation.
With the proposed optimization settings and forced fresh optimization, the
counter, Tailwind styling, and document-preserving navigation passed without
browser exceptions or a dependency-discovery reload. The same cold browser
check then passed using the actual updated framework plugin in the workspace.
The new regression test runs Vite's optimizer with a fresh temporary cache and
checks that lazy-page dependencies are ready before loading the page, with no
new dependency discovery or browser-hash change during its transformation.

After the fix, `pnpm test` passed **81 files and 628 tests**; the strengthened
cold-start regression passed again individually. The maintainer installed the
updated local tarball. Its installed plugin matched the fixed source exactly,
and its dependencies resolved entirely within the independent app. With Node 22,
forced fresh Vite optimization and browser caching disabled, hydration, Tailwind,
and document-preserving navigation passed with no browser exceptions, console
errors, or dependency-discovery reload. The independent production build,
read-only check, and emitted Worker checks passed again, including safe input
serialization and the greeting's `no-store` policy.

On 2026-09-05 the maintainer deployed version
`1ceabba4-aa9c-4674-8461-c09d7e75a6e5` as `goribu-starter`, with only the `ASSETS`
binding. Live HTTP checks confirmed the home page, compiled immutable-cached
stylesheet, request-specific greeting, escaped input, and a 404 for an unknown
route. Headless Chrome against the public URL confirmed the hydrated counter,
36px Tailwind heading, and document-preserving greeting round trip without
browser exceptions or console errors. The browser was closed after verification.

## Second substep — create-goribu

The independent starter exercise justified a generator: manually filtering local
state, replacing `workspace:*`, choosing package/Worker/resource names, and adding
pnpm's build permissions were repeatable setup work. Those tasks now belong to
`packages/create-goribu`, not a sequence of undocumented copying steps.

The published predecessor was inspected as reference, as directed by the source
mapping. Its copying path is coupled to TypeScript erasure, language-specific
overrides, and the older runtime/template. No module was ported. The new CLI is
plain JavaScript with no dependencies and one output format. It accepts a single
project name and an optional local framework tarball, prepares all substitutions
before writing, exclusively creates a new target, and refuses existing files,
directories, and symlinks. There is no force mode, automatic install, Git setup,
login, provisioning, or deployment. Interrupted writes remain available for
inspection rather than triggering recursive cleanup.

The template is still authored only at `templates/basic-app/`. A build/prepack
script snapshots an explicit set of app source roots into ignored
`dist/template.json`, encoding file bytes so dotfiles survive package packing.
Symlinks and special files fail packaging. The packed CLI carries this payload
and does not reach back into the repository. Generated apps retain the same
route code, Tailwind, and agent instructions; repository-only README guidance
is removed using explicit markers, and pnpm build permissions are supplied.

The snapshot records the exact sibling framework version. While it is `0.0.0`,
generation requires `--goribu-tarball`; no `latest` fallback can accidentally
select the incompatible published predecessor. Relative archive paths resolve
from the caller's directory and become absolute `file:` references. The archive
must remain available for later installs. The scaffolder package is private and
publication remains separate maintainer-owned work. TypeScript and TS-to-JS
conversion remain post-gate.

The focused tests passed **3 tests** against a real packed/extracted CLI outside
the repository. They cover source/dotfile fidelity, app identity, standalone
instructions and build permissions, exclusion of local state, non-overwrite
safety, invalid arguments, and the unpublished-version guard. The first test
attempt also exposed Corepack selecting another pnpm version when invoked from
a temporary directory; packing now starts from the repository's pinned context,
while generation still runs independently outside it.

The full `pnpm test` suite then passed **82 files and 631 tests**, and
`git diff --check` passed. Both packages were packed into a fresh temporary
directory; the extracted CLI generated `goribu-generated` there using the real
framework archive, without hand-editing any generated application files.

After the maintainer installed the workspace and generated app, the lockfile
registered the dependency-free CLI and the focused packed-CLI tests passed again
with **3 tests**. Goribu, React, Vite, and Tailwind resolved entirely inside the
generated app's own installation. Its normal `pnpm dev` command passed the first
browser load with browser caching disabled: the counter incremented, Tailwind
set the heading to 36px, and navigation to the greeting and back preserved the
document, with no console errors, browser exceptions, or dependency-discovery
reload. The development server and browser were stopped afterward.

The generated app's `pnpm build` and read-only `pnpm check` both passed. The build
prerendered the home page and emitted the correctly named `goribu_generated`
Worker. The installed Wrangler test harness served the static home and hashed
Tailwind asset, and verified request-specific greeting props, the `no-store`
policy, and safe serialization of script-shaped input. The harness was closed
after verification. No new deployment or npm publication was performed in this
substep; the starter's existing live proof remains recorded above. This closes
the scaffolder substep, not the whole block.

The getting-started guide and second small app remain later substeps. This block
does not publish replacements for the existing npm packages automatically.

## Third substep — getting started

`docs/getting-started.md` now follows the actual unpublished setup path: obtain
this rebuild's checkout, install its dependencies, pack the framework to a
durable sibling directory, build and run the local scaffolder, install the
generated app, exercise both page types, build/check, authenticate with bundled
Wrangler, and run `pnpm run deploy`. It explicitly distinguishes these packages
from their published predecessors, explains the local archive's lifetime and
independent dependency behavior, and records the Node/version, target-directory,
authentication, and pnpm command-collision pitfalls found during validation.

The public guide retains its existing `/docs/installation` URL and site content
location, replacing the obsolete hand-assembly instructions rather than adding
a second onboarding route. A focused test keeps the repository and site versions
synchronized apart from headings, front matter, and link forms; it checks local
onward links and parses the actual shell blocks without executing installs or
deployment. The old repository installation page remains a minimal-file
reference and directs new apps to the guide. The homepage now links directly to
getting started, and the introduction no longer implies this unpublished path
is one command.

Validation: the guide contract and packed-scaffolder tests passed **2 files and
4 tests**. `pnpm --dir site exec goribu build` passed and statically output all
18 routes, including the updated guide. JSDOM checks against that production
output confirmed the managed title, single heading, actual command text, local
onward links, and homepage call to action. No framework source or dependency
changes were needed. The full suite was not rerun for this documentation-only
slice; the previous full result remains 82 files and 631 tests.

The maintainer's first guide deployment succeeded. Live HTTP checks confirmed
the updated homepage call to action, guide content, title, and browser asset,
but exposed a D1 onward link still written as `./d1.md`. The link conversion and
its test had only matched letters and hyphens, missing the digit in `d1`. The
site link is now `/docs/d1`; the contract test handles digits and rejects any
remaining relative Markdown links in the public guide. The corrected test and
site build passed, and rendered-HTML validation confirmed all six internal
onward links, including D1.

Maintainer redeployment `2284c0e9-3431-4250-a54f-522cbaca2997` closed this substep.
Live HTTP checks confirmed the corrected D1 URL, all six internal onward links
returning HTTP 200, the guide's title and current command text, and the homepage
call to action. The guide is live at
https://goribu-site.aggelos-gesoulis.workers.dev/docs/installation. Only the second
small app's end-to-end proof remains before the block can close.

## Fourth substep — a minimal second app

The maintainer requested a minimal app to deploy. `examples/goribu-split` was
generated with the documented local scaffolder and a newly packed framework,
then customized into a bill splitter. Its home page calculates shares in whole
cents, distributes the remainder without changing the total, validates input,
and announces results accessibly. The starter greeting became a static About
page, giving client navigation a real consumer. Both pages need no per-request
data, and no D1/KV, API endpoint, or new dependency was added.

The app is tracked but deliberately outside the root pnpm workspace. It retains
the generated independent workspace/build permissions and uses the framework
archive under ignored `examples/.artifacts/`. Its generated absolute tarball
reference was made relative for a movable source checkout; no runtime wiring
changed. The app README records packing, installation, tests, build/check, and
maintainer-owned deployment to the intended `goribu-split` Worker.

The app's two Node test-runner tests passed: exact totals across even/uneven,
tiny/large splits, and repair messages for invalid input. All three route files
parsed successfully and `git diff --check` passed. These are source/calculation
checks only.

After maintainer installation, the two calculation tests passed again, and
resolution checks confirmed that Goribu, React, Vite, and Tailwind came from
the example's independent installation. Its normal dev command and headless
Chrome passed uneven and tiny-bill calculations, invalid-input feedback, Reset,
document-preserving About navigation, managed route titles, and a 390px layout
without horizontal overflow. No browser exceptions or console errors occurred.
The dev server and browser were stopped afterward.

The production build passed and statically output `index.html` and `about.html`.
The app's installed Wrangler test harness verified both pages, their titles,
the initial €42.00 / 3 calculation, compiled Tailwind, and absence of D1/KV
bindings, then closed. `pnpm check` passed with no resources or migrations.
A read-only Wrangler lookup returned code 10007, confirming `goribu-split` did
not already exist on the selected account. These checks did not deploy or
provision anything.

On 2026-09-05 the maintainer deployed version
`53565380-a22f-4e64-b9cc-eaa825872c4e` to
https://goribu-split.aggelos-gesoulis.workers.dev with only the `ASSETS` binding.
Live HTTP checks confirmed the home and About pages, managed titles, initial
calculation, immutable CSS/JS assets, and 404 handling. Headless Chrome against
the public URL passed uneven and tiny-bill splits, invalid-input feedback,
Reset, document-preserving navigation, route title changes, and mobile layout,
with no console errors or browser exceptions. The browser was closed afterward.

The second app required no new framework API or dependency. Its only
checkout-specific adjustment was making the generated local archive reference
relative, recorded above. This satisfies the block's final proof: the documented
scaffolder path produced a useful independent app at a public URL. Further work
is post-gate and maintainer-selected; publishing either npm replacement is not
implied by completion.
