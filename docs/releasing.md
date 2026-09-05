# Releasing Goribu

`goribu` and `create-goribu` share one release version and one npm channel,
`latest`. The first release from this rebuild is planned as `0.7.0`. Preparation
does not mean publication: until both replacement packages are available on npm,
use the [local getting-started path](./getting-started.md).

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

## Publication contract

Publishing is a deliberate maintainer action. The release command will be added
in the next preparation batch; there is no combined publisher in this tree yet.
Its required sequence is:

1. Validate matching versions and release metadata; run the checks and pack both
   packages. Review and exercise the actual archives outside the workspace.
2. Publish the tested framework archive to `latest` and confirm that exact
   version is available before publishing the matching scaffolder archive.
3. If publication is interrupted, verify any already published archive matches
   the intended artifact before resuming. Package publication is not atomic
   across the two names, and a published version cannot be overwritten.
4. Verify both registry versions and tags, then create and exercise an app using
   the public scaffolder and its registry dependency.
5. For the first replacement only, remove the predecessor's `alpha` tag after
   both publications succeed. Keep older versions available; do not unpublish
   them or assign a second maintained release channel.
6. Update the changelog and onboarding documentation to reflect the verified
   public path, then verify the live guide after maintainer deployment.

The release process must use the tested archives rather than repacking different
bytes at publication time. Package README release-preparation notices must be
replaced with final installation instructions before those archives are frozen.
The public site's guide changes after the registry path works.

There is no automatic publishing on commits, CI publishing workflow, separate
prerelease channel, or independent scaffolder version schedule. Dependency
installation, commits, and deployments remain maintainer-owned.
