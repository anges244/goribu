# Block 8 — Starting an app (in progress)

The first substep is complete and live at
https://goribu-starter.aggelos-gesoulis.workers.dev. The independent installation,
cold-start browser checks, production build, and maintainer deployment all passed.
The remaining block substeps have not started. No public npm package has changed.

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

The `create-goribu` assessment, getting-started guide, and second-app proof remain
later substeps. This block does not publish replacements for the existing npm
packages automatically.
