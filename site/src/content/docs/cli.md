---
title: The CLI
description: Develop, build, inspect, deploy, and migrate from one front door.
---

The CLI is Goribu's front door. Run it from the application directory (where
`goribu.config.js` lives).

```
goribu <command> [options]
```

Running `goribu` with no command, `-h`, or `--help` prints usage. `-v` or
`--version` prints the installed version. An unknown command or an unsupported
argument fails with a `[Goribu]` message explaining what to run instead —
commands never silently ignore input.

## `goribu dev`

Start the local development server. Vite serves the real Worker through workerd
(the Workers runtime) with hot module replacement, so what you see locally
matches production. The server runs until you stop it.

```
goribu dev [--port <number>] [--host]
```

- `--port <number>` (or `--port=<number>`) listens on that port. A port you name
  is strict: if another program is using it, `goribu dev` exits with an error
  instead of moving to the next free port, so the URL you asked for is the URL
  you get.
- `--host` listens on every network interface, so another device on your network,
  such as a phone, can open the Network URL Vite prints. Anyone on that network
  can then reach your development server and whatever your routes return from
  local D1, KV, and R2. It takes no address.

Both apply to this run only. They override the `server` settings in
`vite.config.js` and stay in effect when the session restarts. Through a package
script, `pnpm dev --port 5199` passes the flag on.

Configuration restarts close the previous server and its local Worker runtime
before starting their replacements, so a long dev session keeps one listening
port and one `workerd` child however many times it restarts. Ctrl+C and SIGTERM
close both.

The session restarts when `vite.config.js` or `goribu.config.js` changes. Goribu
checks the replacement configuration before stopping anything: if it cannot load,
the error is reported, the running server keeps serving the configuration it
already has, and the session restarts on its own once the file is repaired. If a
replacement passes that check and still fails to start — an occupied port with
`strictPort`, say — the session stops, releases its Worker runtime, and exits
non-zero with the error and a repair instruction.

`goribu.config.js` reaches a running session only through that restart; it is
never hot-updated into the Worker on its own, so a config Goribu rejects cannot
reach your app. Goribu's generated `.goribu/` directory is not watched either,
because Goribu writes it and a rewrite is not a reason to restart. The generated
root `goribu.wrangler.jsonc` is excluded for the same reason.

Adding, removing, or renaming routes also restarts the session so Worker routing
and browser page loaders stay synchronized. Changes to a route's default export,
HTTP handler exports, or `prerender` setting, and changes to selected middleware,
Document, or error-page files use the same path. Rapid edits are checked again
after startup. Ordinary component bodies and styles keep using Vite's hot updates.
An invalid route edit is reported and retried when repaired; because source files
still participate in HMR, the page can show an error until that repair.

If an import points to a local file that does not exist yet, creating that file
inside the watched project retries the affected server modules and reloads the
browser. You do not need to edit the importing file again or restart the server.
Resolution still follows Vite, including aliases and omitted extensions.

Development styles load before hydration through `/_goribu/dev-styles.css`.
Repeated requests reuse discovered imports from unchanged Vite transforms;
edited imports are inspected again. Stylesheet contents and hot updates remain
owned by Vite, so this optimization needs no application configuration. The
first-paint stylesheet stays in place until the first hot update, so web fonts
it has loaded are not dropped when the page hydrates.

On a development reload, text in a `font-display: swap` web font can briefly
show its fallback font. Vite serves development files with `Cache-Control:
no-cache`, so the browser checks the font with the server before using it.
Production builds serve hashed fonts with an immutable cache policy and do not
have this delay.

Local Worker values come from root `.env` plus `.env.local`, or from `.dev.vars`
which suppresses both. Edits reload the session. See
[Environment variables](/docs/environment-variables) for precedence and how
browser values differ from Worker bindings.

To change the defaults for every run, set Vite's `server.port`,
`server.strictPort`, and `server.host` in `vite.config.js`. Without
`strictPort: true`, a port set there moves to the next free port when it is
occupied at startup. A specific listening address and `server.allowedHosts`
(needed when you open the server through a hostname, such as a tunnel) are set
only there.

## `goribu build`

Produce the production build: one pass emits the Worker bundle and the client
bundle into `.goribu/dist/`, along with the deploy-ready Wrangler configuration.
Takes no arguments.

```
goribu build
```

Successful builds print the discovered output paths after prerendering finishes.
HTML, browser assets, and static-navigation data live in `.goribu/dist/client/`;
the Worker bundle and deployment configuration live in
`.goribu/dist/<worker-environment>/`. Generated framework asset URLs remain
under `/_goribu/`; public file URLs are unchanged.

Goribu owns these output locations. Remove conflicting `build.outDir`,
per-environment output paths, and bundler `output.dir`/`output.file` overrides.
`emptyOutDir: false` is rejected: each build must remove stale HTML and
navigation snapshots. Cleanup stays inside the output directories, preserving
Goribu's generated inputs and local Cloudflare state.

When upgrading, update scripts or CI artifact paths that refer to root `dist/`.
Goribu leaves any existing root `dist/` untouched; you can remove old generated
output yourself. Keep `goribu.wrangler.jsonc` at the project root so environment
file discovery continues to work.

Builds suppress the bundler's `MODULE_LEVEL_DIRECTIVE` warning for `"use client"`
in `node_modules`: library React Server Component annotations do not control
Goribu's rendering. Application directives, `"use server"`, and other diagnostics
still reach your configured log handlers. This affects logging only, not bundles.

## `goribu cloudflare-login`

Log in to Cloudflare through Goribu's installed Wrangler. Takes no arguments.

```sh
pnpm exec goribu cloudflare-login
```

Wrangler opens the browser authorization flow and stores the credentials for
later runs. Login needs no application configuration or build. Goribu passes
through Wrangler's terminal interaction and exit status; it does not manage
credentials itself. For non-interactive authentication, configure
`CLOUDFLARE_API_TOKEN` instead.

Login is explicit: `goribu deploy` checks credentials before building and asks
you to repair authentication if needed.

## `goribu deploy`

Check Wrangler credentials and account selection before building, provision
D1 and KV, apply pending D1 migrations, then deploy to Cloudflare. Authentication
failure stops before the build, even without resources; run `goribu cloudflare-login` or
configure credentials, then retry. Standalone `goribu build` needs no
authentication. The Worker is uploaded only after the schema step succeeds.
See [Deploying](/docs/deploy) for details.

When `.env.production` exists, a Wrangler dry run validates it before
provisioning or migrations, then deployment uploads it as secrets. Otherwise,
existing platform secrets are used. Local `.env` is never uploaded as fallback.

```
goribu deploy
```

## `goribu check`

Read the production deployment plan without changing resources. It reports the
Worker target, D1/KV resources and bindings, cost warnings, and real production
migration status. It also reports the production secrets file and intended
action, without values or key counts.

```sh
goribu check
```

## Migration commands

Local D1 is the default; `--remote` selects production:

```sh
goribu migrate
goribu migrate --remote
goribu migrate:status
goribu migrate:status --remote
goribu migrate:down
goribu migrate:down --remote
goribu migrate:new create posts
goribu migrate:seed
```

Seed is local-only. Deploy applies pending production migrations before Worker
upload; `goribu migrate --remote` can advance a compatible schema earlier. See
[Migrations](/docs/migrations) for the file format, drift behavior, and safe
production order.

## `goribu d1`

Run SQL against D1 and print the result, local by default:

```sh
goribu d1 "SELECT * FROM posts LIMIT 5"
goribu d1 --remote "SELECT count(*) FROM posts"
```

Local is the database `goribu dev` and `goribu migrate` use. With `--remote`, a
single `SELECT` runs directly; any other SQL runs only after you type the
database name in an interactive terminal, and is refused in scripts, CI, and
coding agents. Make repeatable production data changes with a
[migration](/docs/migrations) instead.

## Exit codes

Every command exits non-zero on failure. A deploy that is interrupted or killed
by a signal is reported as a failure, never as a successful deploy.

**Next:** [Routing](/docs/routing).
