# Development restart and shutdown

Record of the fix for `goribu dev` accumulating listening ports and `workerd`
children across restarts. Not part of the published docs; the shipped behavior
is described in `docs/cli.md` and the decision is in `docs/decisions.md`.

## What was wrong

Three defects, stacked.

1. **A retained Worker runtime.** `@cloudflare/vite-plugin` keeps one Miniflare
   instance alive across a restart: its `close` hook skips `disposeMiniflare()`
   while its own `restart` wrapper is on the stack. But the runner worker's
   `moduleRunners` map is only ever written to — `dist/workers/runner-worker/index.js`
   has no `delete` — so the replacement environments hit
   `Module runner already initialized` and the restart fails.
2. **A restart that schedules another restart.** Goribu regenerates `.goribu/`
   from the Vite `config` hook, which runs on every config load. One of those
   files is the Wrangler config that the Cloudflare plugin watches to decide a
   restart is needed. The write landed while the previous server's watcher was
   still open, so whether it produced another restart depended on where the
   filesystem event fell relative to that plugin's in-flight guard. Overlapping
   restarts are what bound several ports to one process; a failed restart binds
   nothing, because Vite creates the replacement with `listen: false`.
3. **No session lifecycle.** `runDev` created a server, listened, and printed
   URLs. Ctrl+C ended the process before Miniflare was disposed, leaving a
   `workerd` child behind.
4. **An unguarded application config.** The generated Worker entry imports
   `goribu.config.js`, so an edit was an ordinary hot update. Vite invalidates the
   module graph before any plugin hook runs, so a config Goribu rejected still
   reached the live Worker and answered requests with a runtime error — while the
   session was being told it had kept running. Only keeping the file out of Vite's
   watcher prevents this.
5. **A server that failed after its configuration checked out.** A replacement can
   pass configuration checks and still fail to start, in two different shapes.
   When it fails to listen, Vite assigns it onto the server first and then
   rejects, which escaped the handler that reports a stopped session. When a setup
   hook throws, Vite catches it, reports it, and drops the half-built server
   without closing it — so its watcher and workerd child outlived the attempt with
   no reference left to reach them. The same is true of the first server a session
   builds.

## What it does now

- `goribu:development-lifecycle` wraps `server.restart` from a `configureServer`
  post hook, so the wrapper sits outside the Cloudflare plugin's own restart
  wrapper. A restart resolves the replacement configuration, closes the server —
  which, not being inside that wrapper, disposes Miniflare and terminates workerd
  and releases the port — and only then lets Vite build the replacement.
- Resolving the configuration first is what makes closing first affordable. It
  runs the same config load and plugin hooks the restart is about to run, so an
  unparseable `vite.config.js`, a `goribu.config.js` that is not a `defineConfig`
  result, a missing route, or a duplicate binding is reported against a session
  that is still serving, and the restart happens by itself once the file is fixed.
- Every server is captured as it is built, from a `configureServer` hook in the
  first group (`enforce: "pre"` and `order: "pre"`, ahead of the Cloudflare
  plugin's and of any application plugin declared after `goribu()`), together with
  the application-config watcher opened for it. If it never takes over, both are
  disposed — whether Vite rejected or swallowed the failure, and on a restart or
  on the first server of a session. The capture has to carry the watcher too,
  because the post hook that would otherwise own it never runs.
- That hook order is a group, not a guarantee: an application plugin declared
  before `goribu()` with the same enforce and order runs first, and then there is
  nothing to capture — only a watcher Vite opened before any hook ran, which
  nothing can reach. Nothing is serving in that case either, so the session ends
  the process rather than sitting open on an unreachable handle.
- A restart that rejects is caught rather than rethrown: the error is reported,
  what was built is closed, and the session exits non-zero with the repair
  instruction. Reporting rather than rethrowing also keeps a watcher callback from
  turning a restart failure into an unhandled rejection.
- Goribu's generators write only when their bytes would change, and `.goribu/` is
  excluded from the dev watcher. `goribu.config.js` is excluded too and watched by
  Goribu instead — a directory watch, so an editor that saves by replacing the
  file is still seen — and re-read per restart rather than once per process. The
  validated restart is the only way it reaches a session.
- `installDevLifecycle` closes the server on SIGINT; Vite keeps SIGTERM. A failed
  initial listen closes too, since the Cloudflare plugin starts workerd while the
  server is being configured.

## Validation

`packages/goribu/tests/dev-lifecycle.integration.test.js` forks the real CLI
against a disposable copy of `fixtures/basic-app`. Each case was confirmed to
fail with its own part of the fix removed:

| Removed | Failure |
| --- | --- |
| the lifecycle plugin | `Module runner already initialized`, `server restart failed` |
| idempotent generated writes | `.goribu/` rewritten on an unrelated restart |
| the `goribu.config.js` re-read | restart regenerates the stale config |
| the application-config watch exclusion | a rejected config answers requests with 500 |
| the thrown-restart handler | no cleanup, no repair instruction, no exit |
| abandoned-server disposal | setup failure leaves a live workerd and hangs |
| ending a session with nothing to dispose | a hook throwing before the capture hangs |
| the plugin's `enforce: "pre"` | a hook throwing after `goribu()` becomes uncapturable |

Excluding `.goribu/` from the watcher closes a race the suite cannot force on
demand; the restart-count assertions would catch it if it reproduced.

Full workspace suite: 88 files / 690 tests. Manually confirmed against a default
port: three config edits, one listener throughout, no restart failures; a broken
`vite.config.js` leaves the session serving with the repair instruction as the
last line; an invalid `goribu.config.js` is refused and the session recovers on
repair without restarting the process.
