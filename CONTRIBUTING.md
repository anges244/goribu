# Contributing to Goribu

Read [AGENTS.md](AGENTS.md) for repository conventions and
[docs/decisions.md](docs/decisions.md) for settled design choices. No private
handoff or planning files are required. Discuss substantial API or architecture
changes with the maintainer before implementing them.

## Local setup

Use Node.js 22+ and pnpm 10.26.2, the version declared in `package.json`.
From the repository root, install the locked workspace dependencies:

```sh
pnpm install --frozen-lockfile
```

The workspace includes both packages, the fixture, the starter, and the site.
The framework runs directly from JavaScript source; there is no package build
step. Integration tests use local workerd processes and ports. Development and
standalone builds do not require Cloudflare credentials.

Run the behavioral fixture locally:

```sh
pnpm --filter basic-app exec goribu dev
```

Or run the legacy site used by integration tests (the public website is
maintained independently in a separate private repository):

```sh
pnpm --filter goribu-site exec goribu dev
```

Stop the server with Ctrl-C. To check production output:

```sh
pnpm --filter basic-app exec goribu build
pnpm --filter goribu-site exec goribu build
```

Output lives under each app's `.goribu/dist/`. The site declares D1 and KV;
production checks and deployment may access your Cloudflare account. Local
test/build commands do not deploy. Change the configured app and resource names
before deploying your own copy.

## Validation

Start with the test for the behavior you changed, for example:

```sh
pnpm test packages/goribu/tests/create-request.test.js --maxWorkers=1
```

Then run the workspace suite:

```sh
VITEST_MAX_WORKERS=1 pnpm test
git diff --check
```

One test worker limits contention between compiler and Worker integration tests.
The suite includes real builds, local servers, package archive checks, and public
type fixtures. Some tests require Git, `tar`, and npm in addition to pnpm; the
release tooling targets macOS/Linux.

Keep changes focused. Add regression coverage for bugs and update the public
declarations when runtime APIs change. Update the changelog and relevant guides;
the getting-started guide and its site counterpart are checked for consistency.
Report the commands you actually ran and any failures in the pull request.

## Starter and independent example

Edit `templates/basic-app/`, then rebuild the scaffolder payload:

```sh
pnpm --dir packages/create-goribu run build
```

Both language variants come from that source. Do not edit generated output.
The [independent example](examples/README.md) uses a packed archive outside the
workspace and has its own dependency installation.

## Documentation and releases

Current guides and decision records are indexed in
[docs/README.md](docs/README.md). Package publication and site deployment are
maintainer-owned; follow [Releasing](docs/releasing.md). A pull request does not
need a version bump unless the maintainer requests one.
