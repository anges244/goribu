# Goribu

A React framework for Cloudflare Workers. File-based routes stream server-rendered
HTML and hydrate in the browser. Routes that need no request-time work build to
plain HTML served by Cloudflare Static Assets. D1 databases, KV namespaces, and
R2 buckets are configured in the app and provisioned during deployment; Postgres
connects through Hyperdrive, and migrations run for both databases. R2 includes
signed downloads and browser uploads. Other Cloudflare features, such as Workers
AI, pass through a `wrangler` block. Request caching needs no binding setup; an
optional application domain connects during deployment.

Goribu requires Node.js 22+ for tooling, React 19, and Vite 8. The current starter
uses TypeScript and Tailwind; add `--js` for JavaScript. Public declarations
cover all four package entries while the framework itself remains JavaScript.

## Getting started

```sh
pnpm create goribu@latest my-app
cd my-app
pnpm install
pnpm typecheck
pnpm dev
```

The scaffolder pins the app's Goribu dependency to its matching release version.
It creates files and prints instructions; installation and deployment are yours
to run.

## App commands

Run these from the generated app directory:

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start Vite and workerd with hot updates. Add `--port <number>` for a fixed port or `--host` for local network access. |
| `pnpm build` | Build the Worker, browser assets, and static HTML. |
| `pnpm typecheck` | Check the TypeScript app without emitting files. |
| `pnpm check` | Inspect the production resource and migration plan read-only. |
| `pnpm exec goribu cloudflare-login` | Log in to Cloudflare through Wrangler. |
| `pnpm exec goribu tail` | Stream live production Worker logs. |
| `pnpm exec goribu d1 "<sql>"` | Run SQL against local D1; `--remote` reads production. |
| `pnpm exec goribu wrangler <args>` | Run Goribu's Wrangler with the deploy account. |
| `pnpm exec goribu local:clear <r2\|kv>` | Delete local R2 objects or KV keys used by `pnpm dev`. |
| `pnpm run deploy` | Check credentials, build, provision resources, apply migrations, and deploy. |

Use `pnpm run deploy` explicitly: `pnpm deploy` is pnpm's own command.

## Public entries

| Import | Purpose |
| --- | --- |
| `goribu` | Links, forms, navigation, and Document asset helpers. |
| `goribu/server` | Worker runtime APIs and application configuration. |
| `goribu/client` | Browser initialization. |
| `goribu/vite` | Vite build integration. |

Interactive forms and client navigation require JavaScript. Static output means
document loads, client navigation, and prefetch use Static Assets without
invoking the Worker; the page can still hydrate and be interactive.

[Documentation](https://goribu.dev/docs)
· [Source](https://github.com/anges244/goribu)

MIT licensed. Copyright (c) 2026 Aggelos Gesoulis.
