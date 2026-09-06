# Releasing Goribu

`goribu` and `create-goribu` share one release version and one npm channel,
`latest`. The first release from this rebuild was `0.7.0`. The examples below
prepare its `0.7.1` patch; substitute the next shared version for later releases.
Preparation does not mean publication: verify the saved archives before
publishing them.

## Version policy

Advance both packages together for every release, including changes that affect
only the framework or only the starter. Use ordinary `major.minor.patch` versions
without prerelease suffixes. During `0.x`, use patch increments for compatible
fixes and minor increments for features or breaking changes, recording breaking
changes explicitly in the changelog. Reaching `1.0.0` is a separate decision
about API stability.

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
`goribu/client`, and `goribu/vite`.

The scaffolder ships its CLI, source, and `dist/template.json`. Its prepack step
builds that payload from the canonical `templates/basic-app/` source. The payload
includes dotfiles as encoded file bytes; generating an app needs neither the
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
pnpm release prepare 0.7.1
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
VITEST_MAX_WORKERS=2 pnpm release pack ../goribu-release-0.7.1
```

Choose a new directory outside the repository, in an existing parent. The command
refuses an existing directory, including an incomplete previous attempt. It
requires a clean Git checkout, runs `git diff --check` and the full `pnpm test`
suite, and packs both packages with pnpm. Two test workers limit contention
between local Worker integration tests; all tests still run. There is no
skip-tests option. Preserve earlier release directories unchanged.

It inspects the actual archives: package names, versions, publication metadata,
tracked source files, executable CLIs, the license, all four framework exports,
and the template's framework version. Unexpected files, local dependencies, and
package README release-preparation notices block completion. The saved scaffolder
is then extracted into a temporary directory and used to generate an app whose
framework dependency must match the release.

A successful run writes three files:

- `goribu-0.7.1.tgz`
- `create-goribu-0.7.1.tgz`
- `release.json`, recording the source commit, version, and SHA-512 archive hashes

The receipt is written last, only after all checks pass and the checkout is
still clean at the same commit. An incomplete directory has no valid completion
receipt. Retain it for inspection and choose a new directory when repacking.

Now independently generate, install, and exercise an app from these archives,
including cold-start development, hydration, navigation, and production build.
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
pnpm release publish ../goribu-release-0.7.1
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
