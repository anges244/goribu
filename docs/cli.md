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

Local Worker values come from root `.env` plus `.env.local`, or from `.dev.vars`
which suppresses both. Edits reload the session. See
[Environment variables](./environment-variables.md) for precedence and how
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
declared D1/KV resources, apply pending production D1 migrations, then deploy to
Cloudflare. Authentication failure stops before the build, including for apps
without resources; run `goribu cloudflare-login` or configure credentials, then retry.
Standalone `goribu build` needs no authentication. The Worker is uploaded only
after the schema step succeeds. See [deploy.md](./deploy.md) for authentication and details.

```
goribu deploy
```

`goribu deploy` takes no arguments.

When `.env.production` exists, a Wrangler dry run validates it before
provisioning or migrations, then deployment uploads it as secrets. Otherwise,
existing platform secrets are used. Local `.env` is never uploaded as fallback.

## `goribu check`

Inspect the production deployment plan without changing resources. Check reports
the Worker target, declared D1/KV resources and bindings, cost warnings, and real
production applied, pending, and drifted migration state. It also reports the
production secrets file and intended action, without values or key counts.

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
