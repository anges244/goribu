# TypeScript and scaffolder review — 0.8.0

Prepared for maintainer review on 2026-09-12. This is an unpublished change;
the review archives are local snapshots, not a release receipt.

## User-visible behavior

```sh
npx create-goribu my-app       # TypeScript + Tailwind
npx create-goribu my-app --js  # JavaScript + Tailwind
```

TypeScript apps include typed routes and `pnpm typecheck`. JavaScript apps retain
JSX and omit `tsconfig.json`, the typecheck script, and direct type dependencies.
Both outputs come from one TypeScript template, converted during packaging;
the published CLI has no runtime compiler dependency.

`goribu.config.js`, `vite.config.js`, and `src/client-entry.js` retain their
existing names. The TypeScript starter checks those JavaScript files too.
The framework implementation remains plain JavaScript ESM.

## Public types

All four public entries carry declarations. Shared types cover links, forms,
Document props, and synchronous route metadata. Server types cover config,
typed handlers and middleware, request input, response intents, cookies, D1,
KV, and the Worker entrypoint. Native D1/KV binding types come from Cloudflare's
type package without adding ambient Worker globals to the app.

`Handler<Props, Env, Params>` connects page props, bindings, and route params.
Body input stays unknown until narrowed; database/JSON generics describe values
but do not validate them. Route type generation and automatic page/handler
inference are deliberately absent.

## Diagnostics

The CLI distinguishes missing names, invalid names, paths passed as names,
unknown options, duplicate flags, missing option values, archive failures,
existing targets, permissions, and packaged-template defects. Each message
identifies the problem and gives a repair for that cause.

For example, `--jss` suggests `--js`; `--ts` explains that TypeScript is already
the default. Filesystem errors include the failing path and error code.
Package defects direct users to retry/report the package rather than edit the
framework. Partial output is preserved if writing fails.

Names ending in a hyphen are rejected before creation: they were accepted by
the previous scaffolder but rejected by Goribu's Worker configuration.

## Validation

- Focused public-type, packed-scaffolder, release, and onboarding checks passed.
- Public fixtures check valid usage and rejected API misuse with both Bundler
  and NodeNext resolution, without skipping dependency declaration checking.
- Both packed variants passed production Vite/workerd checks for static output,
  Tailwind assets, and request-specific greetings with escaped input.
- Both independent installations contain all 105 framework files byte for byte
  from the review archive. Their framework, React, Vite, and Tailwind resolutions
  stay inside each app. The independent TypeScript typecheck passed.
- `pnpm test --maxWorkers=1` passed 86 files / 651 tests. The final focused
  starter/onboarding run passed 2 files / 5 tests after adding the generated
  TypeScript app to the automated typecheck gate.
- Both independent production builds and read-only `pnpm check` commands passed.
- Isolated Chrome checks passed in development and production for both apps,
  with zero browser errors: first-paint home styles, counter hydration,
  metadata, document-preserving navigation both ways, and direct greetings.
  Development entry loading was delayed 1200 ms to expose unstyled first paint.
- Both production harnesses verified static HTML identity, immutable JavaScript
  assets, no-store greetings, and unknown-route 404s. All test servers and
  isolated browsers were closed.
- `git diff --check` passed.

The initial sandboxed integration attempt failed to open local ports; the
permitted rerun passed. Full-suite attempts with two workers were terminated
(exit 143 and exit 137); neither is a passing run. The export guard was reduced
to its entry-file scope after a timing failure; resolved signatures remain
covered by the separate compiler fixtures.

Review snapshots and both installed apps are at
`/private/tmp/goribu-080-review-qm09npto`. `review-archives.json` records hashes;
`installed-audit.json` records file matching and independent resolution. The
full-suite log is `/private/tmp/goribu-080-full-tests-serial.log`; browser logs
use `/private/tmp/goribu-080-{ts,js}-{dev,production}-browser.log`.

## Review follow-up

The three requested refinements are implemented:

- Local archive validation reads one byte and closes the handle in `finally`,
  avoiding a whole-archive allocation while retaining filesystem diagnostics.
- Shared starter prose is language-neutral. JavaScript packaging removes marked
  TypeScript-only sections and updates file references without globally replacing
  the word “TypeScript.” A regression fixture preserves a legitimate mention in
  both generated Markdown files and verifies unchanged TypeScript source bytes.
- Packaging checks the starter manifest's JSON, `scripts`, and `devDependencies`
  before conversion. Missing or malformed maps produce `[Goribu]` errors naming
  the file, required field, and repair, before a payload is written.

After these changes, the packed-scaffolder suite passed 9 tests and the release
suite passed 9 tests, each run with `--maxWorkers=1`. JavaScript syntax checks
and `git diff --check` also passed. The release suite uses real archives and
scaffolding, with simulated registry mutations and Git/test boundaries.

The saved review snapshots predate this follow-up and were preserved. Comparing
their template payloads with the rebuilt payload shows changes only to
`README.md` and `AGENTS.md` in each language. All 104 non-manifest framework files
still match the archive byte for byte; `package.json` differs only by the trailing
newline removed during packing. The full workspace and browser checks above
were not repeated for this follow-up. Final release packing rebuilds the
scaffolder and runs the full suite from the maintainer's clean commit.

`docs/releasing.md` already specifies `VITEST_MAX_WORKERS=1` and explains its
purpose. The installed Vitest recognizes that setting. The earlier termination
codes alone do not establish that the two-worker runs exhausted memory.

## Release boundary

Both package versions are prepared at 0.8.0. Onboarding, the TypeScript guide,
package READMEs, release guidance, changelog, and decisions describe the new
behavior. The pre-existing onboarding edits were retained and extended.

No commit, branch, publication, or deployment was created. After review and a
maintainer commit, create final archives from that clean commit with:

```sh
VITEST_MAX_WORKERS=1 pnpm release pack ../goribu-release-0.8.0
```

Publication and live verification follow the existing release process. The
separate registry-confirmation polling issue is outside this change.

Suggested commit message: `feat: add TypeScript starter and actionable scaffolder errors`
