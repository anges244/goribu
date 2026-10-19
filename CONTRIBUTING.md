# Contributing to Goribu

Goribu is not accepting pull requests yet. Bug reports are welcome as GitHub
issues: include the Goribu and Node.js versions, the smallest app or steps that
reproduce the problem, and what you expected instead. Report security
vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not as
issues. You can reach me on X at [@anges244](https://x.com/anges244).

The rest of this guide covers working in the repository. Read
[AGENTS.md](AGENTS.md) for repository conventions and
[docs/decisions.md](docs/decisions.md) for settled design choices.

## Local setup

Use Node.js 22+ and pnpm 10.26.2, the version declared in `package.json`.
From the repository root, install the locked workspace dependencies:

```sh
pnpm install --frozen-lockfile
```

The workspace includes both packages, the fixture, and the starter.
The framework runs directly from JavaScript source; there is no package build
step. Integration tests use local workerd processes and ports. Development and
standalone builds do not require Cloudflare credentials.

Run the behavioral fixture locally:

```sh
pnpm --filter basic-app exec goribu dev
```

Stop the server with Ctrl-C. To check production output:

```sh
pnpm --filter basic-app exec goribu build
```

Output lives under the app's `.goribu/dist/`. The fixture declares KV;
production checks and deployment may access your Cloudflare account. Local
test/build commands do not deploy. Change the configured app and resource names
before deploying your own copy.

When a change needs live verification, deploy a dedicated test app, run the
checks, then delete the Worker and every resource it created. Fixture routes
accept anonymous writes, so no test deployment stays up between checks. Record
the outcome in the docs without hostnames, account subdomains, or Worker version
IDs.

## Validation

Start with the test for the behavior you changed, for example:

```sh
pnpm test packages/goribu/tests/create-request.test.js --maxWorkers=1
```

For quick feedback across the unit and lightweight contract tests:

```sh
pnpm test:fast
```

This uses up to four isolated workers. It skips the build, Worker integration,
CLI dispatch, package archive, and public type suites listed in
`vitest.fast.config.js`. A fast pass is not complete validation.

Before submitting a change, run the complete workspace suite:

```sh
VITEST_MAX_WORKERS=1 pnpm test
git diff --check
```

One test worker limits contention between compiler and Worker integration tests.
The suite includes real builds, local servers, package archive checks, and public
type fixtures. Some tests require Git, `tar`, and npm in addition to pnpm; the
release tooling targets macOS/Linux.

See [Testing the framework](docs/testing.md) for test selection, temporary app
and cache isolation, and the distinction between test counts and coverage.

Keep changes focused. Add regression coverage for bugs and update the public
declarations when runtime APIs change. Update the changelog and relevant guides.
Record the commands you actually ran and any failures.

## Starter

Edit `templates/basic-app/`, then rebuild the scaffolder payload:

```sh
pnpm --dir packages/create-goribu run build
```

Both language variants come from that source. Do not edit generated output.

## Documentation and releases

Current guides and decision records are indexed in
[docs/README.md](docs/README.md). Package publication and website deployment are
maintainer-owned; follow [Releasing](docs/releasing.md).
