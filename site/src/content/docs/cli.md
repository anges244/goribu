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

## `goribu build`

Produce the production build: one pass emits the Worker bundle and the client
bundle into `dist/`, along with the deploy-ready Wrangler configuration. Takes no
arguments.

```
goribu build
```

## `goribu deploy`

Check Wrangler credentials and account selection before building, provision
D1 and KV, apply pending D1 migrations, then deploy to Cloudflare. Authentication
failure stops before the build, even without resources; log in with Wrangler or
configure credentials, then retry. Standalone `goribu build` needs no
authentication. The Worker is uploaded only after the schema step succeeds.
See [Deploying](/docs/deploy) for details.

```
goribu deploy
```

## `goribu check`

Read the production deployment plan without changing resources. It reports the
Worker target, D1/KV resources and bindings, cost warnings, and real production
migration status.

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
