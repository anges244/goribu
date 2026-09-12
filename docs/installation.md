# Installing Goribu

## Requirements

- **Node.js 22 or newer.**
- A package manager. The examples use [pnpm](https://pnpm.io/).
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) — only needed to
  run `goribu deploy`, not for local development.

## Status

The `goribu` framework and its `create-goribu` scaffolder are published on npm.
Follow [Getting started](./getting-started.md) for the canonical path from
`pnpm create goribu@latest` to an independently generated, deployed app.

The rest of this page is a reference for the minimal framework files, not a
second setup procedure. The starter defaults to TypeScript (`--js` selects JavaScript) and adds Tailwind, a custom Document, and a
request-time greeting to these fundamentals. `fixtures/basic-app` is a regression
test target, not the starter to copy.

## Dependencies

A Goribu app depends on the framework plus its peers:

- `goribu` — the framework and its CLI.
- `react` and `react-dom` — rendering (React 19).
- `vite` — the build and dev-server engine.

```jsonc
{
  "type": "module",
  "dependencies": {
    "goribu": "…",
    "react": "^19.2.8",
    "react-dom": "^19.2.8"
  },
  "devDependencies": {
    "vite": "^8.2.2"
  }
}
```

`"type": "module"` is required — Goribu projects are ES modules.

## Project files

Goribu expects four files at the project root and under `src/`.

### `goribu.config.js`

The single application configuration channel. It carries the deploy identity
and an optional Worker response-header callback. See
[metadata.md](./metadata.md#csp-nonces-and-response-headers).

```js
import { defineConfig } from "goribu/server";

export default defineConfig({
  name: "my-app",
  compatibilityDate: "2026-08-31",
});
```

`name` is the Cloudflare Worker name (lowercase letters, digits, and hyphens).
`compatibilityDate` is the Workers compatibility date. You never write a Wrangler
file — Goribu synthesizes it from this config.

### `vite.config.js`

Wire in the Goribu plugin. It composes the production build and the dev server,
so there is nothing else to configure here.

```js
import { goribu } from "goribu/vite";

export default {
  plugins: [goribu()],
};
```

### `src/routes/index.jsx`

Your first route. Goribu routes by file: every file under `src/routes/` becomes
a URL, and `index.jsx` is the site root (`/`). A route default-exports a React
component.

```jsx
export default function IndexPage() {
  return (
    <main>
      <h1>Hello from Goribu</h1>
    </main>
  );
}
```

Add more routes by adding files — `src/routes/about.jsx` serves `/about`,
`src/routes/posts/[id].jsx` serves `/posts/:id`. See [routing.md](./routing.md).

### `src/client-entry.js`

The browser entry hydrates the initial page and installs navigation and forms:

```js
import "goribu/client";
```

Import global browser CSS here as well. Production fingerprints this graph;
development serves it through Vite. Browser-visible environment values must use
the `PUBLIC_` prefix; see [metadata.md](./metadata.md#public-browser-environment).

## Running it

Install dependencies with your package manager, then use the CLI:

- `goribu dev` — start the local development server.
- `goribu build` — produce the production bundles.
- `goribu deploy` — deploy to Cloudflare.

See [cli.md](./cli.md) for the full command reference and
[deploy.md](./deploy.md) for deploying.
