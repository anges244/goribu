# Development server recovery review

## Missing imports

A working module could acquire a missing local import, report HTTP 500, and stay
broken after the missing file was created. Editing the importer or restarting the
server recovered it. This reproduces without Goribu in both installed dependency
sets: Vite 8.2.2 / Cloudflare plugin 1.54.2 and Vite 8.3.0 / plugin 1.57.2.

Vite's server import analysis leaves an unresolved import out of its file graph.
Its browser-only failed-resolution registration does not supply the missing
server edge when the file appears. The importer retains a cached transform and
the module runner retains its rejected evaluation. A runner reload alone does
not fix both caches; a reload attributed to the newly created file may also be
ignored because the runner has never loaded that file.

The development-only recovery plugin records unresolved server imports
through Vite's resolver. On file creation it retries those resolutions using the
same resolver, preserving aliases and extension inference. Newly resolved imports
invalidate their affected importers; an ordinary environment reload retries the
Worker entrypoints and refreshes the browser. No server restart or dependency
patch is needed. Records are cleared on importer transforms/deletion and scoped
to the environment lifetime. Retrying all pending resolutions also handles files
created together, whose watch events may arrive in another order.

Review exposed a gap in the original relative/absolute specifier filter: Vite
rewrites `resolve.alias` before this hook, but applies native
`resolve.tsconfigPaths` afterward. A missing `@local/newfile` therefore escaped
tracking. The hook now delegates all server import specifiers except internal
null-prefixed IDs to Vite and records only unresolved results. Successful package
and external resolutions are not retained. Unresolved package names may be
retried on file creation too; recovery still requires a non-external resolution.

## Route inventories

The generated Worker imports, route facts, selected special files, and browser
page loaders previously changed only during configuration. Adding a route could
therefore remain a 404 despite the filesystem watcher seeing it.

A development-only plugin compares the existing canonical route, Document,
error-page, and middleware scans after route-tree events. Structural changes use
Goribu's existing validated restart. This regenerates both inventories together
and preserves runtime disposal, configuration validation, watch exclusions, and
port ownership. Component bodies and CSS do not change the inventory and keep
using Vite's normal hot updates.

Each server compares its configuration-time inventory with the tree after it
starts listening. An edit during replacement startup therefore triggers another
pass instead of being lost when concurrent restart requests coalesce. Invalid
intermediate inventories report through the existing preflight and are retried
on repair. This does not promise the old page remains usable during invalid
source edits: those files still participate in Vite's HMR graph.

## Validation

Before the native-path review fix, full `pnpm test --maxWorkers=1` passed
**94 files / 722 tests** in 306.13 seconds,
including existing lifecycle, stylesheet, and production static-navigation checks.
Log: `/private/tmp/goribu-dev-recovery-full.log`. The first sandboxed attempt was
stopped after local-port/log-access failures; the completed run used the local
permissions required by those integrations. Syntax and `git diff --check` passed.

The missing-import integration first failed on the original implementation, then
passed with the fix. It covers repeated relative/alias imports, omitted
extensions, batched creation, deletion/recreation, and recovery without a server
restart. Three added lifecycle stories exercise actual Worker responses and the
browser loader module across route additions, removals, renames, export changes,
special-file selection, invalid edits, and changes during replacement startup.

The native-path review regression uses `resolve.tsconfigPaths: true` with a real
`tsconfig.json` paths mapping. It reproduced the persistent HTTP 500 before the
specifier-filter fix, then passed afterward: creating the target restores HTTP
200 and browser-module transformation without changing the importer or server
environments. Both development integration suites passed **2 files / 18 tests**
after this fix. Logs: `/private/tmp/goribu-native-paths-before.log` and
`/private/tmp/goribu-native-paths-after.log`. The full suite and Chrome probes
were not repeated for this follow-up.

An isolated Chrome probe against a disposable copy of current framework source
using the site's installed Vite 8.3.0 / Cloudflare plugin 1.57.2 passed 22 checks.
An open error page recovered after missing relative and aliased files appeared;
fresh requests also returned 200. Component/CSS edits worked after recovery.
Adding a route refreshed the open page, and its Link reached the new route while
preserving the document. Report:
`/private/tmp/goribu-dev-recovery-site-MOtS3c/report.json`.

One earlier rapid-edit probe observed stale CSS after import recovery. Two repeats
of that timing passed 16 checks each; that does not establish the cause or rule
out an intermittent race. The initial report is preserved at
`/private/tmp/goribu-dev-recovery-site-nGQkZL/report.json`, and repeats at
`/private/tmp/goribu-dev-recovery-race-gRstcI/report.json` and
`/private/tmp/goribu-dev-recovery-race-NJSOh4/report.json`. No CSS-specific fix is
claimed. All isolated browser and dev-server probes were closed.

The unrelated static-navigation work remains in place. Both new plugins apply
only to development; production continues to use prerendered Static Assets.
No version changes, dependency installations, commits, branches, or deployments
are part of this work. The intermittent CSS report remains a separate diagnostic
question; this change introduces no CSS-specific workaround.

Suggested commit: `fix: recover dev imports and refresh route inventories`.
The maintainer committed the five previously untracked static-navigation files
in `b31643c` during the review follow-up. The existing installed site remains on
its released package. The browser probe used a disposable copy, not a replacement
installation.
