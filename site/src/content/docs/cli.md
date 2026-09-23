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
matches production. The server runs until you stop it. Takes no arguments.

```
goribu dev
```

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

Local Worker values come from root `.env` plus `.env.local`, or from `.dev.vars`
which suppresses both. Edits reload the session. See
[Environment variables](/docs/environment-variables) for precedence and how
browser values differ from Worker bindings.

Vite's `server.port` and `server.strictPort` settings remain available in
`vite.config.js`. Set `strictPort: true` to fail when your chosen port is occupied;
otherwise Vite may choose another port at initial startup.

## `goribu build`

Produce the production build: one pass emits the Worker bundle and the client
bundle into `dist/`, along with the deploy-ready Wrangler configuration. Takes no
arguments.

```
goribu build
```

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

## Exit codes

Every command exits non-zero on failure. A deploy that is interrupted or killed
by a signal is reported as a failure, never as a successful deploy.

**Next:** [Routing](/docs/routing).
