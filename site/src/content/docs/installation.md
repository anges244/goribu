---
title: Getting started
description: Generate a JavaScript and Tailwind app, run it locally, and deploy it to Cloudflare.
---

## Before you start

This guide creates a JavaScript app with Tailwind, a static home page with a
working counter, and a request-time greeting. You do not need to copy routes or
read framework source.

**This Goribu rebuild is unpublished.** The `goribu` and `create-goribu`
packages already on npm belong to the older implementation. Do not use
`pnpm create goribu` or install `goribu@latest` for this guide. For now, obtain
a checkout of this rebuild from its maintainer; the commands below package that
checkout locally. A public registry installation path is not available yet.

You need:

- Node.js 22 or newer, including in the directory where you create the app.
- pnpm; the repository and generated app select version 10.26.2.
- A Cloudflare account only when you are ready to deploy.

These shell examples use macOS/Linux. Start in the rebuild's repository root,
which contains `packages/goribu`, `packages/create-goribu`, and `templates/basic-app`.
Installs, login, and deployment are actions for you, the maintainer—not actions
the scaffolder performs.

## 1. Prepare the local packages

Check Node and install the repository dependencies:

```sh
node --version
pnpm install
```

Keep this shell open for the next two steps. Save the checkout path and create a
new sibling directory for your apps and framework archive:

```sh
GORIBU_REPO="$PWD"
mkdir ../goribu-apps
GORIBU_APPS="$(cd ../goribu-apps && pwd)"
pnpm --dir packages/goribu pack --pack-destination "$GORIBU_APPS"
pnpm --dir packages/create-goribu run build
```

If `../goribu-apps` already exists, choose a different new directory name in both
lines; do not empty or overwrite it. Packing creates `goribu-0.7.0.tgz`.
Building the scaffolder prepares its template; it does not install anything.

## 2. Generate your app

Choose a project name such as `my-first-app`: 1–50 lowercase letters, digits,
or hyphens, starting with a letter. Pass a name, not a path. Its target directory
must not already exist—even an empty directory is refused.

```sh
cd "$GORIBU_APPS"
node "$GORIBU_REPO/packages/create-goribu/bin/create-goribu.js" my-first-app --goribu-tarball "$GORIBU_APPS/goribu-0.7.0.tgz"
cd my-first-app
pnpm install
pnpm dev
```

The app has its own dependencies and pnpm workspace. The generator sets its
package name, Worker name, and commented resource names. It includes pnpm's
build permissions for esbuild and workerd; it does not install dependencies,
initialize Git, log in, or deploy.

Keep the archive in `goribu-apps`: the app uses an absolute `file:` dependency,
so future installs still need it. Do not move or delete it while the app depends
on it. To test a later framework revision, pack it to a new location, update the
app's `goribu` dependency, and reinstall. A generated app does not automatically
follow edits in the framework checkout.

## 3. See both kinds of page work

Open the local URL printed by `pnpm dev`.

1. Click the home page counter. It should increment after hydration.
2. Follow the greeting link. You should see “Hello, friend.”
3. Visit `/hello?name=Astra` to see the request change the greeting.
4. Use the home link to return.

The home page has no GET handler. Its production HTML is built once and served
from Static Assets without invoking the Worker, while the counter still runs
in the browser. The greeting exports GET and renders at request time. Interactive
controls and client navigation require JavaScript.

Edit `src/routes/index.jsx` to change the home page, or
`src/routes/hello.jsx` to change the greeting. Tailwind belongs to the app's
Vite configuration, and `src/styles.css` scans the app's source. Use complete
class names rather than constructing names such as `bg-${color}-500`.

The generated `AGENTS.md` explains the application conventions and maintainer
ownership. Do not edit `node_modules/`, `dist/`, `.goribu/`, or `.wrangler/`.

## 4. Build and review the target

Stop the dev server with Ctrl-C. From your app directory:

```sh
pnpm build
pnpm check
```

The build produces a browser bundle and Worker bundle, then reports
`index.html` as statically output. It should not report `hello.html` as static.

Review `goribu.config.js`. The generated Worker name is your project name.
Choose a name that does not belong to another app in your Cloudflare account:
deploying to an existing name updates that Worker. Goribu generates Wrangler
configuration; do not write a separate Wrangler file.

`pnpm check` reads the deployment plan without changing resources. The bare
starter declares no D1 or KV, so its plan has no resources or migrations. In this
case `check` does not verify your Cloudflare credentials; deploy's authentication
preflight does that. Development and standalone builds need no Cloudflare login.

## 5. Deploy to a public URL

From the app directory, authorize the bundled Wrangler if needed:

```sh
pnpm --dir node_modules/goribu exec wrangler login
```

Then deploy:

```sh
pnpm run deploy
```

Keep the explicit `run`: `pnpm deploy` is pnpm's own workspace deployment
command, not the app's script. It can fail with
`ERR_PNPM_NOTHING_TO_DEPLOY` without running Goribu.

Goribu checks authentication and account selection before building, then uploads
the new Worker and static assets. This is a production deployment, not a preview.
Wrangler prints the public `workers.dev` URL and version ID.

Open that URL and repeat the counter and greeting checks from step 3. You now
have an independently generated Goribu app deployed to Cloudflare. For a working
example of this starter, see the
[deployed starter](https://goribu-starter.aggelos-gesoulis.workers.dev).

For non-interactive authentication, use `CLOUDFLARE_API_TOKEN`; set
`CLOUDFLARE_ACCOUNT_ID` when credentials can reach multiple accounts. See
[Deploying](/docs/deploy) for details and resource permissions.

## Add data when you need it

D1 and KV are off by default. Uncomment either app-specific declaration in
`goribu.config.js` when needed, then restart dev. Goribu owns the generated
`DB` and `KV` bindings and separates local storage from production.

Use [D1](/docs/d1) for authoritative records and numbered
[migrations](/docs/migrations) for schema. Deploy applies pending migrations
before uploading the Worker; keep them compatible with the previously deployed
version because schema changes and Worker deployment are not atomic.

Use [KV](/docs/kv) for data that can tolerate delayed visibility. An immediate
reread does not prove a write succeeded across KV's distributed caches.

## If a step fails

- **Node is too old after changing directories:** select Node 22+ again in that
  shell before running the command.
- **The target already exists:** choose a new project name. The scaffolder never
  overwrites your files and has no force mode.
- **The tarball is missing:** restore it at the path in `package.json`, or point
  the dependency at your new packed archive and reinstall.
- **Wrangler is not authenticated:** run the bundled login command above, or
  repair the token/account environment variables, then retry `pnpm run deploy`.
- **You installed the published predecessor:** regenerate with this checkout's
  scaffolder and local tarball; do not mix the two runtime/template generations.

**Next:** [The CLI](/docs/cli) for the complete command reference, or
[Routing](/docs/routing) to add your own pages.
