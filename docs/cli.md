# The `goribu` CLI

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
declared D1/KV resources, apply pending production D1 migrations, then deploy to
Cloudflare. Authentication failure stops before the build, including for apps
without resources; log in with Wrangler or configure credentials, then retry.
Standalone `goribu build` needs no authentication. The Worker is uploaded only
after the schema step succeeds. See [deploy.md](./deploy.md) for authentication and details.

```
goribu deploy
```

`goribu deploy` takes no arguments.

## `goribu check`

Inspect the production deployment plan without changing resources. Check reports
the Worker target, declared D1/KV resources and bindings, cost warnings, and real
production applied, pending, and drifted migration state.

```sh
goribu check
```

`goribu check` takes no arguments. Its migration section states whether deploy
will create the database and which pending files it will apply before uploading
the Worker.

## Migration commands

Migration commands target local D1 unless `--remote` is passed:

```sh
goribu migrate                         # apply pending locally
goribu migrate --remote                # apply pending in production
goribu migrate:status                  # inspect local status
goribu migrate:status --remote         # inspect production status
goribu migrate:down                    # roll back one local migration
goribu migrate:down --remote           # roll back one production migration
goribu migrate:new create posts        # scaffold the next migration
goribu migrate:seed                    # run migrations/seed.sql locally
```

`migrate:seed` is local-only and rejects `--remote` before SQL runs. See
[migrations.md](./migrations.md) for file naming, drift, rollback safety, and
deploy ordering. `goribu migrate --remote` remains useful when an expand
migration should land before the corresponding Worker deploy.

## Exit codes

Every command exits non-zero on failure. A deploy that is interrupted or killed
by a signal is reported as a failure, never as a successful deploy.
