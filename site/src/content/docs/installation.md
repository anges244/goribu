---
title: Getting started
description: Requirements, the files a Goribu app needs, and running it.
---

## Requirements

- **Node.js 22 or newer.**
- A package manager. The examples use [pnpm](https://pnpm.io/).
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) — only needed to
  run `goribu deploy`, not for local development.

## Status

Goribu is pre-release. It is not yet published to a registry, and there is no
project scaffolder yet — a template and `create-goribu` come later. For now you
assemble a project by hand. The pieces are small, and this page lists all of
them.

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

Goribu expects a few files at the project root and under `src/`.

### `goribu.config.js`

The single application configuration channel. It carries the deploy identity
and an optional Worker response-header callback.

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

Your first route. Goribu routes by file: every file under `src/routes/` becomes a
URL, and `index.jsx` is the site root (`/`). A route default-exports a React
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
`src/routes/posts/[id].jsx` serves `/posts/:id`. See [Routing](/docs/routing).

### `src/client-entry.js`

The browser entry hydrates the initial page and installs navigation and forms:

```js
import "goribu/client";
```

Import global browser CSS here as well. Production fingerprints this graph;
development serves it through Vite.

## Running it

Install dependencies with your package manager, then use the CLI:

- `goribu dev` — start the local development server.
- `goribu build` — produce the production bundles.
- `goribu deploy` — deploy to Cloudflare.

**Next:** [The CLI](/docs/cli).
