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
second setup procedure. The starter defaults to TypeScript (`--js` selects
JavaScript) and adds Tailwind, a custom Document, and one static welcome page
to these fundamentals. `fixtures/basic-app` is a regression test target, not
the starter to copy. The starter includes `public/favicon.svg`, linked from
`src/setup/_document.tsx` (`.jsx` in JavaScript apps). Put directly served assets
in `public/`; for example, `public/logo.svg` is available at `/logo.svg`.

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

### `src/setup/client-entry.js`

This file is required, including when you use Goribu's default Document.
The browser entry hydrates the initial page and installs navigation and forms:

```js
import "goribu/client";
```

Import global browser CSS here as well, for example
`import "../styles/global.css";`. Its path is an app convention, not a
framework requirement. Production fingerprints this graph;
development serves it through Vite. Browser-visible environment values must use
the `PUBLIC_` prefix; see [metadata.md](./metadata.md#public-browser-environment).

## Running it

Install dependencies with your package manager, then use the CLI:

- `goribu dev` — start the local development server.
- `goribu build` — produce the production bundles.
- `goribu deploy` — deploy to Cloudflare.

See [cli.md](./cli.md) for the full command reference and
[deploy.md](./deploy.md) for deploying.

## Migrating existing apps to `src/setup/`

When upgrading from the previous layout:

1. Move `src/client-entry.js` to `src/setup/client-entry.js`.
2. Move your custom `src/routes/_document.*` to `src/setup/_document.*`, retaining
   its extension. If you use the default Document, there is nothing to move.
3. Set the custom Document's entry to
   `<ClientEntry src="/src/setup/client-entry.js" nonce={nonce} />`.
4. Update relative imports in both moved files. To adopt the starter's CSS layout,
   move `src/styles.css` to `src/styles/global.css` and import it as
   `../styles/global.css` from the client entry. Update CSS-relative asset paths
   and Tailwind's source base too: the starter uses
   `@import "tailwindcss" source("../");` to scan all of `src/`.

Remove the old copies. Development and builds report migration errors for old
setup locations instead of silently ignoring your Document. `_404`, `_500`, and
folder-level `_middleware` remain under `src/routes/`. Restart development after
migrating, then run your type check (if present) and production build.
