# Independent application proof

`goribu-split/` is the small bill-splitter built through the documented
`create-goribu` path for Block 8. It is intentionally outside the framework's
pnpm workspace: installs and builds use a packed framework, not a workspace link.

From the repository root, prepare its unpublished framework dependency:

```sh
pnpm --dir packages/goribu pack --pack-destination "$PWD/examples/.artifacts"
```

Then the maintainer installs the app's dependencies:

```sh
pnpm --dir examples/goribu-split install
```

The package references `../.artifacts/goribu-0.0.0.tgz`. Keep that ignored archive
available for future installs. Packing it again deliberately updates the local
artifact; reinstall the app when testing those framework changes. Do not commit
archives, installed dependencies, or generated output. No npm package is
published by these commands.
