# Releasing Goribu

`goribu` and `create-goribu` share one release version and one npm channel,
`latest`. The first release from this rebuild was `0.7.0`. The examples below
prepare `0.9.0`, including R2 storage and uploads, request caching, application
custom domains, live Worker logs, and deployment/client fixes;
substitute the next shared version for later releases.
Preparation does not mean publication: verify the saved archives before
publishing them.

## Upgrading apps from 0.8.1 to 0.9.0

After both packages are verified on npm, update an existing app with
`pnpm add --save-exact goribu@0.9.0` from its directory, then rebuild and deploy.
The new APIs and configuration are opt-in; existing apps need no configuration
migration.

- Review [R2](r2.md) before adding buckets or uploads. Build before running
  `goribu check` so its read-only plan includes current upload requirements.
- Add an application [`domain`](deploy.md#custom-domain) only when you want
  deployment to connect that hostname. Existing domains remain connected.
- Use [`req.cache`](cache.md) for JSON caching and
  [`goribu tail`](cli.md#goribu-tail) for live production logs.
- Fix lowercase or mixed-case HTTP handler exports reported by the build:
  use uppercase names such as `GET` and `POST`.
- Confirm the authenticated Cloudflare account before redeploying. Deploy now
  explicitly uses that account for secret validation and Worker upload, even if
  the app's `.env` sets `CLOUDFLARE_ACCOUNT_ID` to a different account. To select
  another authorized account, set `CLOUDFLARE_ACCOUNT_ID` in your shell.
- Rebuild and deploy to replace previously uploaded client source maps if
  `build.sourcemap` is enabled. New client maps omit embedded source text.

Newly generated apps include the starter favicon; existing apps retain their
own public assets and Document.

## Upgrading apps from 0.8.0 to 0.8.1

After both packages are verified on npm, update an existing app with
`pnpm add --save-exact goribu@0.8.1` from its directory. Before rebuilding:

- Move `src/client-entry.js` into `src/setup/`, and move any custom
  `src/routes/_document.*` beside it. Update the Document's `<ClientEntry src>`
  to `/src/setup/client-entry.js` and adjust relative imports. See the
  [setup migration](installation.md#migrating-existing-apps-to-srcsetup).
- Update scripts and CI that read root `dist/` to use `.goribu/dist/`. Builds
  leave old root output untouched and reject `emptyOutDir: false`.
- Multipart `req.body()` now returns field objects: replace `body.get("name")`
  with `body.name`, remove `instanceof FormData` branches, and handle repeated
  fields as arrays. Uploaded values remain `File` objects. See
  [request bodies](handlers.md).
- Prerendered pages now use their build-time props and metadata for client
  navigation and prefetch as well as document loads, without invoking the
  Worker. Set `prerender = false` for query-dependent server output. See
  [navigation](navigation.md).

Rebuild and deploy after migrating. The new single-page starter applies to newly
generated apps; existing apps retain their own routes and styles.

## Upgrading apps from 0.7.2 to 0.8.0

After both packages are verified on npm, update an existing app with
`pnpm add --save-exact goribu@0.8.0` from its directory, then rebuild and deploy.
Existing JavaScript apps do not need conversion. New apps default to TypeScript;
add `--js` to retain JavaScript scaffolding.

- Remove the obsolete generated `.goribu/wrangler.json`, keeping
  `.goribu/worker.js`. Add root `goribu.wrangler.jsonc` to the app's `.gitignore`;
  Goribu now generates its Wrangler config there.
- Local Worker values come from `.env` plus `.env.local`, or `.dev.vars` which
  suppresses both. Older mode-file server overrides belong in `.env.local`.
  Review `.env.production`: deploy now uploads that file as Worker secrets when
  present. See [Environment variables](environment-variables.md) for precedence,
  browser values, and validation.
- Remove `prerender = true` from routes with non-GET handlers, or move those
  handlers to a separate action route. These routes now stay on the Worker so
  Static Assets cannot shadow their handlers.
- Rebuild and deploy to replace the old CSS filenames. Updating a dependency
  alone does not change assets already uploaded to Cloudflare.

## Version policy

Advance both packages together for every release, including changes that affect
only the framework or only the starter. Use ordinary `major.minor.patch` versions
without prerelease suffixes. During `0.x`, use patch increments for compatible
fixes and minor increments for features or breaking changes, recording breaking
changes explicitly in the changelog. Reaching `1.0.0` is a separate decision
about API stability.

At the maintainer's request, `0.8.1` is an exception to that increment policy:
it includes the breaking changes documented in the upgrade notes and changelog.

`0.7.0` advances beyond the existing package histories: at preparation time,
`goribu` has reached `0.1.0-alpha.9` and `create-goribu` has reached `0.6.9`.
The repository's rebuild number does not determine the npm version.

The template's `workspace:*` dependency selects local Goribu during repository
development. The scaffolder's build records the sibling framework's exact
version and refuses mismatched package versions, `0.0.0`, and prerelease versions.
Generated apps use that exact version, with no caret range or `latest` dependency.
`--goribu-tarball` remains the override for testing an unpublished local revision.
Packaging does not check whether the selected version exists on npm.

## Package contents

The framework ships its plain JavaScript ESM source and CLI, with no framework
compilation step. Its four public entries remain `goribu`, `goribu/server`,
`goribu/client`, and `goribu/vite`, each with a matching public declaration.
Type fixtures run in `pnpm test`; the archive audit requires all runtime and
type entry files.

The scaffolder ships its CLI, source, and `dist/template.json`. Its prepack step
builds that payload from the canonical `templates/basic-app/` source. The payload
contains the canonical TypeScript files and JavaScript generated from them,
including dotfiles as encoded file bytes; generating an app needs neither the
repository nor a runtime template download. Only the payload file is allowed
from `dist`, so other generated files cannot enter the package accidentally.

Both packages have package-specific READMEs and MIT licensing. The root license
must be present in both packed archives. Tests, fixtures, installed dependencies,
local application state, and the template's workspace lockfile do not ship.

## Release commands

Run the repository command from its root, using Node.js 22+, the pinned pnpm,
npm, Git, and `tar` on macOS/Linux. Install the workspace dependencies yourself
before using it. The command never installs, commits, creates Git tags, logs in,
or deploys the site.

### 1. Prepare the version

```sh
pnpm release prepare 0.9.0
```

For later releases, supply the new version once. This updates both package
manifests and rebuilds the embedded starter. It refuses backwards versions and
prerelease suffixes. Repeating the current version just rebuilds the template.
Review the changelog and package READMEs, then commit your changes yourself.
Preparation can leave version edits for inspection if rebuilding fails; repair
the reported problem before continuing.

Package READMEs describe the installation path that the published archives will
provide. Keep publication claims tied to verified registry state.

### 2. Test and pack

```sh
VITEST_MAX_WORKERS=1 pnpm release pack ../goribu-release-0.9.0
```

Choose a new directory outside the repository, in an existing parent. The command
refuses an existing directory, including an incomplete previous attempt. It
requires a clean Git checkout, runs `git diff --check` and the full `pnpm test`
suite, and packs both packages with pnpm. One test worker limits resource
contention between compiler and Worker integration checks; all tests still run. There is no
skip-tests option. Preserve earlier release directories unchanged.

It inspects the actual archives: package names, versions, publication metadata,
tracked source files, executable CLIs, the license, all four framework exports,
and the template's framework version. Unexpected files, local dependencies, and
package README release-preparation notices block completion. The saved scaffolder
is then extracted into a temporary directory and used to generate both TypeScript and JavaScript apps whose
framework dependencies must match the release.

A successful run writes three files:

- `goribu-0.9.0.tgz`
- `create-goribu-0.9.0.tgz`
- `release.json`, recording the source commit, version, and SHA-512 archive hashes

The receipt is written last, only after all checks pass and the checkout is
still clean at the same commit. An incomplete directory has no valid completion
receipt. Retain it for inspection and choose a new directory when repacking.

Now independently generate, install, and exercise both variants from these
archives: the default TypeScript output and `--js` output. Run `pnpm typecheck`
in the TypeScript app; verify cold-start development, hydration, navigation,
first-paint styles, and production builds for both. The JavaScript app must
work without TypeScript configuration or direct type dependencies.
The pack command's file and scaffolder checks do not replace this installation
proof. Keep the reviewed release directory intact. It is a local artifact record,
not a signed provenance attestation.

### 3. Publish the saved pair

After reviewing and exercising those archives, authenticate with npm if needed:

```sh
npm login --registry=https://registry.npmjs.org/
```

Then one command publishes both packages:

```sh
pnpm release publish ../goribu-release-0.9.0
```

The checkout must remain clean at the commit recorded by `pack`. The command
checks both archive hashes and contents, copies the verified bytes to a private
temporary directory, and checks registry state for both names before the first
mutation. npm owns authentication and any interactive two-factor challenge.
Neither authentication nor a registry read proves that a later upload will
succeed.

It publishes `goribu` first, verifies npm reports the matching SHA-512 integrity
and `latest` tag, then publishes and verifies `create-goribu`. Publication uses
explicit public-registry, public-access, and `latest` settings, with lifecycle
scripts disabled. It uploads the saved archives and never repacks them.
[npm supports publishing a local archive and records its integrity](https://docs.npmjs.com/cli/v11/commands/npm-publish/).

Registry confirmation is required between packages. If an uploaded version is
not visible yet, the command stops with instructions to wait and retry; it does
not publish the scaffolder while the framework is unconfirmed.

For `0.7.0` only, after both replacements are verified, the command removes
Goribu's old `alpha` tag if it still points to the known `0.1.0-alpha.9`
predecessor. An unexpected alpha target requires inspection instead of removal.
Older versions remain available; nothing is unpublished.

### Interrupted publication

Rerun the same publish command with the same saved directory and source commit.
There is no separate resume command or second channel.

- A matching version already on npm is verified and skipped. If its `latest`
  tag has not advanced yet, the command updates that tag and verifies it.
- Different or missing integrity for an existing version blocks the release.
  Restore the original archives or choose a new shared version. A published
  name/version cannot be overwritten.
- A newer `latest` blocks the release; retrying an old directory never downgrades
  the channel.
- Network, authentication, HTTP, and malformed metadata errors stop publication.
  They are never interpreted as evidence that a version is available to publish.
- A failed alpha-tag cleanup can be retried after the two releases have succeeded.

The two npm publications and tag operations are separate operations, not a
transaction. Run one release at a time. Fresh reads detect conflicting registry
state, but cannot lock out another publisher on a different machine. No rollback
or unpublish operation is attempted.

## Close the public release

After npm verification, create a fresh app through `pnpm create goribu@latest`
and verify its registry dependency and behavior. Update the changelog, root
README, and onboarding guide to reflect the verified public path. The maintainer
then deploys the site; verify the live guide afterward.

There is no automatic publishing on commits, CI publishing workflow, separate
prerelease channel, or independent scaffolder version schedule.
