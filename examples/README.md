# Independent application proof

`goribu-split/` is the small bill-splitter built through the documented
`create-goribu` path for Block 8. It is intentionally outside the framework's
pnpm workspace: installs and builds use a packed framework, not a workspace link.

From the repository root, pack the current framework and select that archive
in the example's independent installation:

```sh
GORIBU_VERSION="$(node -p 'require("./packages/goribu/package.json").version')"
pnpm --dir packages/goribu pack --pack-destination "$PWD/examples/.artifacts"
cd examples/goribu-split
pnpm add --save-exact "file:../.artifacts/goribu-$GORIBU_VERSION.tgz"
pnpm dev
```

The maintainer runs the installation command. The checked-in manifest and
lockfile preserve the original `0.0.0` proof archive; a fresh clone does not have
that archive. The `pnpm add` step replaces that reference and refreshes the
example's lockfile for the current version. Review those local dependency changes
before committing them. Keep the ignored archive available for later installs.
Repack and repeat the add step to test further framework changes. Do not commit
archives, installed dependencies, or generated output.

See the [app README](goribu-split/README.md) for behavior, checks, and deployment.
