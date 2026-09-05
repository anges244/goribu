# Goribu

A React framework for Cloudflare Workers. File-based routes stream server-rendered
HTML and hydrate in the browser. Routes that need no request-time work build to
plain HTML served by Cloudflare Static Assets. D1 databases, migrations, and KV
namespaces are configured in the app and provisioned during deployment.

Goribu requires Node.js 22+ for tooling, React 19, and Vite 8. The current starter
uses JavaScript and Tailwind. Public TypeScript declarations are not available yet.

## Getting started

**Release preparation:** this checkout targets `0.7.0`, which is not published
yet. Use the [getting-started guide](https://goribu-site.aggelos-gesoulis.workers.dev/docs/installation)
for the current local-package setup. Existing npm releases belong to the previous
implementation.

After both `0.7.0` packages are published, the registry setup will be:

```sh
pnpm create goribu@latest my-app
cd my-app
pnpm install
pnpm dev
```

The scaffolder pins the app's Goribu dependency to its matching release version.
It creates files and prints instructions; installation and deployment are yours
to run.

## App commands

Run these from the generated app directory:

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start Vite and workerd with hot updates. |
| `pnpm build` | Build the Worker, browser assets, and static HTML. |
| `pnpm check` | Inspect the production resource and migration plan read-only. |
| `pnpm run deploy` | Authenticate, build, provision resources, apply migrations, and deploy. |

Use `pnpm run deploy` explicitly: `pnpm deploy` is pnpm's own command.

## Public entries

| Import | Purpose |
| --- | --- |
| `goribu` | Links, forms, navigation, and Document asset helpers. |
| `goribu/server` | Worker runtime APIs and application configuration. |
| `goribu/client` | Browser initialization. |
| `goribu/vite` | Vite build integration. |

Interactive forms and client navigation require JavaScript. Static output means
the request needs no Worker; it can still hydrate and be interactive.

[Documentation](https://goribu-site.aggelos-gesoulis.workers.dev/docs/introduction)
· [Source](https://github.com/anges244/goribu3)

MIT licensed. Copyright (c) 2026 Aggelos Gesoulis.
