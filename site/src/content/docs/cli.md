---
title: The CLI
description: dev, build, and deploy — the three commands.
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

Build, then deploy to Cloudflare with Wrangler. The build output — the Worker and
its static assets — is uploaded as-is. Wrangler handles authentication, prompting
the first time it is needed. See [Deploying](/docs/deploy) for details.

```
goribu deploy
```

## Exit codes

Every command exits non-zero on failure. A deploy that is interrupted or killed
by a signal is reported as a failure, never as a successful deploy.

**Next:** [Routing](/docs/routing).
