# Getting started

## Before you start

This page describes the upcoming 0.8.0 release. Use the reviewed local archives
until its npm publication has been verified.

This guide creates a TypeScript app with Tailwind, a static home page with a
working counter, and a request-time greeting. You do not need to copy routes or
read framework source.

You need:

- Node.js 22 or newer, including in the directory where you create the app.
- pnpm; the generated app selects version 10.26.2.
- A Cloudflare account only when you are ready to deploy.

These shell examples use macOS/Linux. Installs, login, and deployment are actions
for you—not actions the scaffolder performs.

## 1. Generate your app

Choose a project name such as `my-first-app`: 1–50 lowercase letters, digits,
or hyphens, starting with a letter and ending with a letter or digit. Pass a
name, not a path. Its target directory
must not already exist—even an empty directory is refused.

```sh
pnpm create goribu@latest my-first-app
cd my-first-app
pnpm install
pnpm typecheck
pnpm dev
```

TypeScript is the default. For JavaScript, add `--js` to the creation command;
that output uses `.jsx` routes and has no `typecheck` script. Skip the
`pnpm typecheck` commands in this guide when using JavaScript.

`create-goribu` writes an independent pnpm workspace and pins the app's `goribu`
dependency to the exact matching release from npm. It sets the package name,
Worker name, and commented resource names, and includes pnpm's build permissions
for esbuild and workerd. It does not install dependencies, initialize Git, log
in, or deploy.

## 2. See both kinds of page work

Open the local URL printed by `pnpm dev`.

1. Click the home page counter. It should increment after hydration.
2. Follow the greeting link. You should see “Hello, friend.”
3. Visit `/hello?name=Astra` to see the request change the greeting.
4. Use the home link to return.

The home page has no HTTP handlers. Its production HTML is built once and served
from Static Assets without invoking the Worker, while the counter still runs
in the browser. The greeting exports GET and renders at request time. Interactive
controls and client navigation require JavaScript.

Edit `src/routes/index.tsx` to change the home page, or
`src/routes/hello.tsx` to change the greeting. Tailwind belongs to the app's
Vite configuration, and `src/styles.css` scans the app's source. Use complete
class names rather than constructing names such as `bg-${color}-500`.

The generated `AGENTS.md` explains the application conventions and maintainer
ownership. Do not edit `node_modules/`, `dist/`, `.goribu/`, `.wrangler/`, or
the generated root `goribu.wrangler.jsonc`.

## 3. Build and review the target

Stop the dev server with Ctrl-C. From your app directory:

```sh
pnpm typecheck
pnpm build
pnpm check
```

`pnpm typecheck` checks types without emitting files. It is separate from
`pnpm build`, which bundles the app. See [TypeScript](./typescript.md) for typed
handlers, metadata, forms, and request validation.

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

## 4. Deploy to a public URL

From the app directory, log in to Cloudflare if needed:

```sh
pnpm exec goribu cloudflare-login
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

Open that URL and repeat the counter and greeting checks from step 2. You now
have an independently generated Goribu app deployed to Cloudflare. For a working
example of this starter, see the
[deployed starter](https://goribu-starter.aggelos-gesoulis.workers.dev).

For non-interactive authentication, use `CLOUDFLARE_API_TOKEN`; set
`CLOUDFLARE_ACCOUNT_ID` when credentials can reach multiple accounts. See
[Deploying](./deploy.md) for details and resource permissions.

## Add data when you need it

D1 and KV are off by default. Uncomment either app-specific declaration in
`goribu.config.js` when needed, then restart dev. Goribu owns the generated
`DB` and `KV` bindings and separates local storage from production.

Use [D1](./d1.md) for authoritative records and numbered
[migrations](./migrations.md) for schema. Deploy applies pending migrations
before uploading the Worker; keep them compatible with the previously deployed
version because schema changes and Worker deployment are not atomic.

Use [KV](./kv.md) for data that can tolerate delayed visibility. An immediate
reread does not prove a write succeeded across KV's distributed caches.

## If a step fails

- **Node is too old after changing directories:** select Node 22+ again in that
  shell before running the command.
- **The target already exists:** choose a new project name. The scaffolder never
  overwrites your files and has no force mode.
- **Wrangler is not authenticated:** run the bundled login command above, or
  repair the token/account environment variables, then retry `pnpm run deploy`.

**Next:** [The CLI](./cli.md) for the complete command reference, or
[Routing](./routing.md) to add your own pages.
