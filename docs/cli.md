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

Vite prebundles the packages your pages import for the browser. Its own startup
scan cannot follow Goribu's lazy page loaders, so Goribu transforms every page at
startup and their packages are optimized before the first page request. A
package that a page first imports while the session is running is still
discovered when that page loads. If it changes chunks Vite already optimized,
Vite reloads the browser once; until that reload the page can briefly fail with a
duplicate-React error such as "Invalid hook call". The next startup optimizes
the package with the rest.

Development styles load before hydration through `/_goribu/dev-styles.css`.
Repeated requests reuse discovered imports from unchanged Vite transforms;
edited imports are inspected again. Stylesheet contents and hot updates remain
owned by Vite, so this optimization needs no application configuration.

Local Worker values come from root `.env` plus `.env.local`, or from `.dev.vars`
which suppresses both. Edits reload the session. See
[Environment variables](./environment-variables.md) for precedence and how
browser values differ from Worker bindings.

Vite's `server.port` and `server.strictPort` settings remain available in
`vite.config.js`. Set `strictPort: true` to fail when your chosen port is occupied;
otherwise Vite may choose another port at initial startup.

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

Login is explicit for deployment: `goribu deploy` checks credentials before
building and asks you to repair authentication if needed.

When deploy, resource inspection in `goribu check`, or a remote migration needs
authentication, use `pnpm exec goribu cloudflare-login` and retry the command.
Goribu displays Wrangler's error details with ordinary login suggestions pointing
to that command. Wrangler-specific login flags and other diagnostic commands stay
as Wrangler commands, run through [`goribu wrangler`](#goribu-wrangler);
`goribu cloudflare-login` accepts no arguments.

## `goribu wrangler`

Run the Wrangler installed with Goribu. Wrangler is a dependency of `goribu`,
not of your app, so a bare `wrangler` command is usually not on your PATH.
Repair messages from check and deploy print their Wrangler commands in this
form, for example:

```sh
pnpm exec goribu wrangler r2 bucket dev-url disable my-files
```

Every argument goes to Wrangler unchanged. It runs in the app directory with
`CLOUDFLARE_ACCOUNT_ID` set to the account `goribu deploy` would use: the
variable you set, or your only account. With several accounts and no variable,
it stops and asks you to set one. It needs a login, like deploy. Goribu passes
through Wrangler's terminal interaction and exit status.

`goribu wrangler deploy` is refused, because it would skip Goribu's build,
provisioning and migrations; use `goribu deploy`. `goribu wrangler deploy
--dry-run` is allowed for diagnostics.

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

The unreleased [R2 feature](./r2.md) also inspects both declared buckets and
creates missing ones and connects the declared public domain before D1/KV
provisioning. After migrations, it creates `GORIBU_SECRET` through Wrangler if
missing. When direct uploads need R2 API keys that are missing, it then asks for
them in the terminal (see [direct-upload deployment](./r2.md#direct-upload-deployment)), then uploads the
Worker. On first deployment, secret setup creates a draft Worker before the final
upload.

An application [`domain`](./deploy.md#custom-domain) is inspected before resource
changes and connected after the Worker upload succeeds. Existing domains and
workers.dev remain available. A domain failure after upload reports that the
Worker is already deployed and exits non-zero so the connection can be repaired
and retried.

## `goribu tail`

Stream live invocation logs, console output, and exceptions from the deployed
production Worker named by the current `goribu.config.js`. No build is needed;
the command does not deploy or change Worker configuration.

```sh
pnpm exec goribu tail
```

Wrangler uses its saved login or `CLOUDFLARE_API_TOKEN` from your shell. To sign in
explicitly, run `pnpm exec goribu cloudflare-login`. Set `CLOUDFLARE_ACCOUNT_ID`
to select the intended account when you have access to several; otherwise,
Wrangler may ask you to select it each run because tail uses a temporary working
directory. The Worker must already be deployed in that account.

Terminal request lines show the actual HTTP response status:

```text
GET https://example.com/hello - 200 OK @ 2026-10-02T10:30:00.000Z
GET https://example.com/missing - 404 Not Found @ 2026-10-02T10:30:01.000Z
GET https://example.com/boom - 500 Internal Server Error @ 2026-10-02T10:30:02.000Z
```

Console messages and exceptions follow the request line. Worker failures appear
separately as `[Worker outcome: exception]`, for example when background work
fails after a response. If Cloudflare supplies no response status, the line says
`HTTP status unavailable`; Goribu does not infer a status from the Worker outcome.
Output remains Wrangler's JSON when piped. Unrecognized event types also retain
their JSON in a terminal.

Only requests that invoke the Worker appear; prerendered pages and other files
served directly by Static Assets do not. This is a live stream, not a historical
log query. See
[Cloudflare real-time logs](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/)
for platform details.

Press Ctrl+C to close the stream and its remote tail session. Shutdown errors
remain visible. If cleanup has not finished after 10 seconds, Goribu stops the
local Wrangler processes and exits non-zero; any remaining remote session will
expire automatically. Output is suppressed once the terminal hangs up.

`goribu tail` takes no arguments: filters, environment selectors, and Wrangler
pass-through options are not supported.

## `goribu check`

Inspect the production deployment plan without changing resources. Check reports
the Worker target, declared D1/KV resources and bindings, cost warnings, and real
production applied, pending, and drifted migration state. It also reports the
production secrets file and intended action, without values or key counts.
When application `domain` is configured, it also checks the zone and hostname
ownership and reports an existing connection or the attachment planned for deploy.
Other connected app domains are listed as information and remain attached.

For the unreleased [R2 feature](./r2.md), check also reports bucket creation,
bindings, domain connection, signing-secret existence, jurisdiction changes,
and continued public access. Problems that would stop deploy, such as public
`r2.dev` access or an enabled custom domain on a private bucket, or missing
direct-upload secrets, appear once in the plan as `Blocked:` items with their
repair. The check then exits non-zero without changing anything; it is a plan
result, not a crash.

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

A failure Goribu recognizes prints its `[Goribu]` message, which says how to
repair it, followed by a `Caused by:` line for any underlying reason the message
does not already state. It prints no stack trace. Any other error is unexpected
and prints in full, with its stack.
