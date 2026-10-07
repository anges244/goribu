# Testing the framework

The framework has two test commands. They run the same existing tests with
different selection and worker settings; neither changes application behavior.

## Choosing a run

Start with the file for the behavior being changed:

```sh
pnpm test packages/goribu/tests/create-request.test.js --maxWorkers=1
```

For routine feedback across unit and lightweight contract tests:

```sh
pnpm test:fast
```

The fast configuration uses up to four workers and retains Vitest's file
isolation. Pass `--maxWorkers=1` to reduce concurrency. It excludes integration
files and the additional Vite build, CLI dispatch, archive, and type-checking
suites named in the root `vitest.fast.config.js`. Some lightweight subprocess
contract tests remain included. New tests requiring a real build or Worker
server should use the `.integration.test.js` suffix.

Before submitting a change or preparing a release, run every test:

```sh
VITEST_MAX_WORKERS=1 pnpm test
git diff --check
```

`pnpm test` has no fast exclusions. One worker limits resource contention among
real builds and Worker processes. Release packing continues to use this full
command. The fast subset is an additional feedback loop, not a release gate.

## Keeping tests independent

Build and serve temporary copies of application inputs. Do not clean or rebuild
the checkout's `fixtures/basic-app` or `site` output from tests: `.wrangler` can
contain a developer's local databases. `tests/support/copy-test-app.js` copies
the common application inputs and any explicitly supplied extra paths, sharing
only the installed dependencies. The caller removes the temporary app during
cleanup. Local env files and generated state are never copied.

When an app shares dependencies through a `node_modules` symlink, set Vite's
`cacheDir` inside the temporary app, such as `join(root, ".vite-cache")`.
Otherwise separate apps can write through the symlink to the same optimizer
cache. Close servers and Worker harnesses before removing their directories.

Each independently selectable test must establish its own prerequisites. The
migration integration tests use a fresh local database per test and apply the
needed migrations within that test, so filtering to a rollback test works.
Sharing immutable build output within a suite is different from depending on
another test's mutations.

## What a passing run establishes

The full suite includes real local Workers, builds, package archive checks,
public TypeScript fixtures, and Node/JSDOM behavior. It does not establish live
Cloudflare behavior or independently installed package behavior. Those remain
the explicit checkpoints described in the release and feature guides.

Test counts are not code coverage percentages. No line or branch coverage
baseline is configured yet. Browser execution is also a separate check: the
existing `scripts/check-navigation-paint.js` requires an installed Chrome or
Chromium executable and is not part of either test command.
