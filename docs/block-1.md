# Block 1 — Dev, build, deploy

The pipeline, before there is anything interesting to push through it. One
hardcoded page proves the road exists and is paved end to end: a project goes
from source to a locally-served Worker, to a production build, to a deploy.

## What landed

- **The CLI (`bin/goribu.js`)** — the framework's front door, built first, not
  last. `dev`, `build`, and `deploy`, plus `--version`, `--help`, and fail-closed
  handling of unknown commands and unexpected arguments.
- **Application config (`defineConfig` from `goribu/server`)** — one branded,
  frozen, fail-closed configuration channel, starting with the deploy fields
  `name`, `compatibilityDate`, and `compatibilityFlags`.
- **The Vite integration (`goribu()` from `goribu/vite`)** — composes the
  production build through `@cloudflare/vite-plugin`, generates the Worker entry
  and the synthesized Wrangler config, and points the client build at
  `src/client-entry.js`.
- **The generated Worker entry** — `.goribu/worker.js`, generated (not
  hand-written), streaming one hardcoded `src/page.jsx` through
  `renderToReadableStream`.
- **Synthesized Wrangler config** — `.goribu/wrangler.json`, produced from
  `goribu.config.js`; the app never hand-writes a Wrangler file.
- **`goribu dev`** — Vite plus workerd serving the real Worker with HMR.
- **`goribu deploy`** — Worker plus static-assets upload to production through
  Wrangler.
- **Docs and ledger** — `installation.md`, `cli.md`, `deploy.md`, a started
  `CHANGELOG.md`, and a running `docs/decisions.md`.

## What emerged

- **The build pipeline is new code, not a port.** The previous version's plugin
  and build were too coupled to routing, the client runtime, and the dev server
  to copy, and it never had a production build at all. So Block 1's build was
  written fresh against `@cloudflare/vite-plugin`, which turns one `vite build`
  into a deploy-ready Worker and client bundle.
- **`configPath` resolves against Vite's root.** The first cut of Wrangler
  synthesis keyed off `process.cwd()` while the plugin used Vite's configured
  root — an inconsistency observable through the public integration, not just a
  future `goribu dev` concern. The fix: pass a relative `configPath` (the
  Cloudflare plugin resolves it against Vite's root) and derive every generated
  artifact from one root in the plugin's `config()` hook.
- **Wrangler had to become a direct dependency.** It is Cloudflare's own deploy
  tool and the plugin already emits a deploy-redirect for it, but it was only a
  buried transitive dependency with no resolvable bin. `goribu` owns `deploy`, so
  it now declares `wrangler` directly and resolves the bin package-relatively.
- **Deploy scope narrowed to production.** The plan originally called for
  per-commit preview deploys; the maintainer scoped Block 1 down to production-only
  `goribu deploy`, deferring preview/versioned deploys and CI because they surface
  shared-binding, versions-vs-deployments, and CI questions not yet answered. The
  plan's substep and "Done when" were amended explicitly to match — a
  `decisions.md` row does not override the plan.

## Non-obvious choices

Recorded in full in [decisions.md](./decisions.md); the ones worth calling out:

- **Config validation reads each field once from its own descriptor.** Iterating
  with the spread/iterable protocol or `Array#some` could observe different
  values than the frozen snapshot keeps (sparse holes, custom iterators,
  accessor elements), so validation and the stored copy are built from the same
  reads.
- **Build guards fail closed with teaching errors.** Missing or non-file
  `goribu.config.js` / `src/page.jsx` are distinguished from other I/O failures
  (`statSync`, not `existsSync`), each with a `[Goribu]` message that says how to
  fix it.
- **The deploy launch is an injectable, tested seam.** `runWranglerDeploy`
  accepts an injectable `spawn`/`resolveBin`, so the launching contract — exact
  arguments, working directory, non-zero exit propagation, spawn errors, and
  signal termination — is tested without a network or a real deploy. A
  signal-killed Wrangler (`code === null`) is reported as failure, never as a
  successful deploy.

## Known residuals

- **The block's public URL is pending a live, authenticated deploy.** The code
  and dry-runs are green, but "serves from a real domain" requires the
  maintainer's Cloudflare credentials.
- **No routing.** Every request renders the one hardcoded page; the scanned
  route tree is Block 2.
- **The client entry is a placeholder.** It exists so the build emits a client
  bundle; hydration and the browser runtime are Block 5.
- **Installation is manual.** No template or `create-goribu` yet — that is
  Block 7.
- **No hand-written types.** TypeScript declarations are post-gate.
