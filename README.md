# Goribu

A React framework for Cloudflare Workers. File-based routes stream server-rendered
HTML and hydrate in the browser. Pages that need no request-time work build to
HTML served by Cloudflare Static Assets. Goribu also provides route handlers,
forms, client navigation, app-configured D1 databases, migrations, KV, and R2
storage and uploads. Request caching needs no binding setup; an optional
application domain connects during deployment.

The starter uses TypeScript and Tailwind; add `--js` for JavaScript.
The framework itself is JavaScript ESM, with public TypeScript declarations.
Interactive forms and client navigation require JavaScript.

## Create an app

Use Node.js 22+ and pnpm:

```sh
pnpm create goribu@latest my-app
cd my-app
pnpm install
pnpm typecheck
pnpm dev
```

For JavaScript, use `pnpm create goribu@latest my-app --js` and skip
`pnpm typecheck`. The scaffolder creates files and prints next steps; it does
not install dependencies or deploy. A Cloudflare account is needed for deployment,
not local development.

See the [documentation](https://goribu.dev/docs/introduction) for the published
guides. This repository can contain changes ahead of npm; check the
[changelog](CHANGELOG.md) and [upgrade notes](docs/releasing.md) when working
from source.

## App commands

Run these from the generated app directory:

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start Vite and workerd with hot updates. |
| `pnpm build` | Build the Worker, browser assets, and static HTML. |
| `pnpm typecheck` | Check a TypeScript app without emitting files. |
| `pnpm check` | Inspect the production resource and migration plan. |
| `pnpm exec goribu cloudflare-login` | Log in to Cloudflare through Wrangler. |
| `pnpm exec goribu tail` | Stream live production Worker logs. |
| `pnpm run deploy` | Build, provision resources, apply migrations, and deploy. |

Use `pnpm run deploy` explicitly: `pnpm deploy` is pnpm's own command.

## Working on Goribu

Read [Contributing](CONTRIBUTING.md) for workspace setup, local development,
and tests. The [documentation index](docs/README.md) lists the repository guides
and contributor references. The [release guide](docs/releasing.md) covers the
shared `goribu` and `create-goribu` version and publication process.

| Directory | Purpose |
| --- | --- |
| `packages/goribu/` | Framework runtime, build integration, CLI, and declarations. |
| `packages/create-goribu/` | Dependency-free app scaffolder. |
| `templates/basic-app/` | Canonical TypeScript/Tailwind starter. |
| `fixtures/basic-app/` | Behavioral integration test app. |
| `site/` | Legacy site retained for integration tests; the public website is maintained separately. |
| `examples/` | Independent example app using a packed framework. |

## License

[MIT](LICENSE), copyright © 2026 Aggelos Gesoulis.
