# Environment loading correction

## Problem and scope

The generated `.goribu/wrangler.json` made Cloudflare look for local `.env` and
`.dev.vars` inside `.goribu/`, while Vite read browser values at the app root.
The earlier framework explicitly bridged that gap by copying values, and
uploaded `.env.production` during deploy. Both behaviors were missing here.

The maintainer approved restoring root `.env` Worker bindings and production
secrets upload using Cloudflare's native mechanisms, with explicit compatibility
notes for the older mode-file and config-evaluation loaders.

## Implementation

- `goribu.wrangler.jsonc` is generated at the app root with a generated-file
  comment and `main: .goribu/worker.js`. One exported filename connects the
  generator, Cloudflare plugin input, and Vite watch exclusion. Writes stay
  idempotent, and both the workspace and starter ignore the file. Workspace
  env-file ignores now also match the starter, with `.env.example` retained.
- `production-secrets.js` selects only `.env.production` and supplies the common
  check/deploy description. It inspects existence without parsing or reporting
  contents. A dangling symlink stays selected so validation rejects it instead
  of silently using existing secrets.
- `runDeploy` resolves the file before building, then validates with Wrangler
  `deploy --dry-run --secrets-file=.env.production` after the build and before
  provisioning, binding finalization, or migrations. The real upload receives
  the same filename. No local `.env` fallback or public-key filtering is added.
- The dry run suppresses subprocess output because parser diagnostics can
  contain source text. A rejected file or built Worker gets a `[Goribu]` error
  with repair instructions. Wrangler remains the sole secrets parser.
- `check` reports the selected file/action without a key count or content
  validation. No dotenv-to-`process.env` loader is added to config evaluation.

## Compatibility and limits

Worker development uses `.env` plus `.env.local`, or `.dev.vars` which suppresses
both. Goribu does not automatically select a Cloudflare environment. Vite mode
files still feed public browser values, but `.env.development` no longer feeds
Worker bindings as it did with the older loader; move server overrides to
`.env.local`. This is documented as a compatibility change.

Production uploads the whole `.env.production`, including public keys, and
preserves omitted platform secrets. Public browser values remain public even
when also uploaded as Worker secrets. The native plugin can emit local secrets
into its preview `.dev.vars`; there is no Goribu-created secrets copy.

The preflight proves what Wrangler accepts from the file at that time. It does
not authenticate API keys with external services or make provisioning,
migrations, and Worker deployment transactional.

## Verification

The final `pnpm test --maxWorkers=1` passed **89 files / 696 tests** in
236.70 seconds. `git diff --check` passed. This includes the new static
environment guide and the corrected D1 fixture. No live deployment was run.

- Empirical pinned Wrangler 4.127.1 probes accepted a synthetic dotenv file and
  rejected empty/invalid input without credential environment variables. The
  built basic-app fixture also passed preflight before provisioning.
- New integration coverage invokes real Wrangler for invalid dotenv, empty
  input, non-string JSON values, a directory, and a dangling symlink, proving
  no provisioner, migration, or deploy runs. Valid dotenv and JSON pass.
- Real CLI sessions cover root `.env` and `.dev.vars`, `.env.local` precedence,
  the Worker/browser mode-file distinction, file edits, one listener/workerd,
  stable generated-file mtimes, and denied HTTP access to the env/config files.
- The first focused run passed 64 of 65 tests. Its single failure was a test
  expecting 403 for a nonexistent `.dev.vars`; the server correctly returned
  404. The corrected lifecycle file passed all 12 tests in 68.15 seconds.
- The first full run passed 693 tests, with one documentation-sync failure and
  two tests skipped by a D1 fixture setup failure. The fixture still parsed the
  new JSONC file as JSON; it now uses the generator's returned config and creates
  its own Worker directory. The published getting-started text was synchronized.
  The focused follow-up passed all 7 tests across those checks and the site build.
  The environment guide now has an explicit site route and joins the existing
  static-guide artifact assertions.
- The fixture built before and after the move. The emitted Wrangler configs
  differ only in `configPath` and `userConfigPath`, which now identify the root
  input file. All other fields match; literal byte identity would falsely retain
  the old source path and is not claimed.

Local logs: `/private/tmp/goribu-env-focused.log`,
`/private/tmp/goribu-env-dev-final.log`,
`/private/tmp/goribu-env-build-before.log`, and
`/private/tmp/goribu-env-build-after.log`,
`/private/tmp/goribu-env-followup.log`, and
`/private/tmp/goribu-env-full-final.log`.

## Maintainer review follow-up

The suppressed preflight error now gives an exact command for seeing Wrangler's
diagnostic, with a warning that its output may include text from the secrets file.
The command uses Goribu's bundled Wrangler because applications need not install
Wrangler directly. `--cwd "$PWD"` keeps the built-artifact and secrets lookup in
the application directory when pnpm runs from the Goribu package. Both environment
guides include the same command.

The changelog tells upgraders to remove the unused `.goribu/wrangler.json` and
retain `.goribu/worker.js`. Generation does not delete the old file. Block 1's
writeup keeps its original account, with a pointer to the superseding 2026-09-14
decision and the current guide.

The extra preflight was measured on a disposable copy of `fixtures/basic-app`,
built with synthetic production values. Five sequential invocations of the real
validation function took **1.329, 1.368, 1.353, 1.370, and 1.355 seconds**: median
**1.355 seconds**, range **1.329–1.370 seconds**. This includes Wrangler process
startup and validation of the emitted Worker through the deploy redirect. The
fixture build took 3.709 seconds separately. These local Node 22.23.0 / Wrangler
4.127.1 measurements establish the added step's cost on this fixture; no remote
deployment or upload duration was measured. Deploys without `.env.production`
skip the preflight.

The documented command was also run against a freshly built disposable fixture
and an invalid synthetic secrets file. It returned exit code 1 and Wrangler's
file-format diagnostic. The first command probe hit a pnpm version mismatch
because the disposable fixture lacked the starter's `packageManager` setting;
copying that setting from the starter allowed the command to run. No dependency
installation was needed.

The focused follow-up passed **2 files / 17 tests** in 11.00 seconds, including
the updated error assertion and native Wrangler validation. The earlier full
696-test run was not repeated for these diagnostic and documentation changes.
Whitespace checks and equality of the two environment-guide bodies passed.
Evidence: `/private/tmp/goribu-env-review-followup-tests.log`,
`/private/tmp/goribu-env-preflight-timing.json`, and
`/private/tmp/goribu-env-preflight-timing-diagnostic.log`.

No dependencies installed, commits created, or production resources changed.
Suggested commit: `fix: restore local env bindings and production secrets`.
