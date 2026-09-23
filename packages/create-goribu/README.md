# create-goribu

Creates a TypeScript/Tailwind app in a new directory; `--js` selects JavaScript. It sets the
package, Worker, and optional resource names; writes an independent pnpm workspace
with the required esbuild/workerd build permissions; and prints the next commands.
It never installs packages, initializes Git, authenticates, provisions, or deploys.

The canonical TypeScript template remains `templates/basic-app/`. `pnpm run build`
packages it and derives JavaScript into ignored `dist/template.json`;
`pnpm pack` does this automatically. TypeScript is a packaging dependency only.
The packed CLI carries that snapshot, including dotfiles, and has no dependencies
or runtime link to the source repository. Never hand-edit the generated snapshot.

## Create an app

With Node.js 22+ and pnpm:

```sh
pnpm create goribu@latest my-app
cd my-app
pnpm install
pnpm typecheck
pnpm dev
```

The app's `goribu` dependency is pinned to the exact matching release. Choose a
name with 1–50 lowercase letters, digits or hyphens, starting with a letter
and ending with a letter or digit.
Pass a name, not a directory path. The destination must not exist.

For JavaScript, run `pnpm create goribu@latest my-app --js`; that output has no
TypeScript configuration, type dependencies, or `typecheck` script. Run
`npx create-goribu --help` for the full option reference.

## Local development

Use Node 22+. From the repository root:

```sh
GORIBU_VERSION="$(node -p 'require("./packages/goribu/package.json").version')"
pnpm --dir packages/goribu pack --pack-destination /absolute/path/to/artifacts
pnpm --dir packages/create-goribu run build
node packages/create-goribu/bin/create-goribu.js my-app --goribu-tarball "/absolute/path/to/artifacts/goribu-$GORIBU_VERSION.tgz"
```

The destination must not exist. Run the CLI from the directory where you want
the app; project names are single lowercase names, not paths. Relative tarball
paths resolve from the invoking directory and become absolute `file:` references.
Keep the archive available for later installs; repack and reinstall deliberately
when testing framework changes.

Then, as the maintainer:

```sh
cd my-app
pnpm install
pnpm dev
```

The generated README covers build, resources, and `pnpm run deploy`. Missing
arguments and unsupported flags fail with repair instructions; `--help` requires
neither a prepared template nor an install. Existing targets are never overwritten,
including empty directories and symlinks. If a filesystem error interrupts writing,
partial output is retained for inspection rather than recursively deleted.

## Packaging and release boundary

`pnpm --dir packages/create-goribu pack --pack-destination /absolute/path/to/artifacts`
builds a self-contained CLI archive. Packaging requires `goribu` and
`create-goribu` to have the same release version. Both packages use `latest`
as their sole release channel.

The snapshot records the exact sibling framework version, not `latest` or the
scaffolder's own independent version. `--goribu-tarball` overrides the release
dependency for local development and unpublished revisions.
The TypeScript source and generated JavaScript are packaged together. Both
outputs are covered by packed-CLI generation and production integration tests;
independent installations remain part of release verification.

[Getting started](https://goribu.dev/docs/installation)
· [Source](https://github.com/anges244/goribu)

MIT licensed. Copyright (c) 2026 Aggelos Gesoulis.
