---
title: Metadata & Document
description: Route-owned head data, the document shell, graph assets, CSP nonces, response policy, and public browser environment.
---

Route modules own page metadata; `src/setup/_document.jsx` owns the HTML shell;
`responseHeaders()` owns defaults for responses that execute on the Worker.

## Route metadata

Export a plain object or a synchronous function:

```jsx
export function meta({ props: { post }, url }) {
  return {
    title: post.title,
    description: post.summary,
    canonical: new URL(url.pathname, "https://example.com").href,
    meta: [{ property: "og:image", content: post.image }],
    links: [{ rel: "alternate", href: `/fr/${post.slug}`, hrefLang: "fr" }],
  };
}
```

The function receives exactly `{ props, url }`. Load asynchronous data in the
handler and return it through `res.render(props)`. Goribu validates metadata
before streaming.

Top-level fields are `title`, `description`, `canonical`, `robots`, `meta`, and
`links`. Descriptor values are strings; unknown or event-like keys, thenables,
and duplicate semantic representations fail with a repair message. Project
front matter into these fields instead of exporting unrelated content metadata.

Every managed head node carries `data-goribu-head`. Client navigation replaces
that complete marked set while preserving viewport, icon, and other
Document-owned nodes. A missing title becomes an empty managed title, so every
route owns its browser-tab text.

For a prerendered page, metadata is a build-time snapshot shared by its static
HTML and client navigation data. Changing a query string does not rerun its
server `meta()` function. Use `prerender = false` when metadata must depend on
the current request.

## Custom Document

```jsx
import { ClientEntry, Stylesheet } from "goribu";

export default function Document({ children, head, nonce }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Stylesheet />
        {head}
      </head>
      <body>
        <div id="root">{children}</div>
        <ClientEntry src="/src/setup/client-entry.js" />
      </body>
    </html>
  );
}
```

Keep `children` under `#root`, render `head` in `<head>`, and place one of each
helper. Production replaces the development client source with its hashed entry
and emits route-specific preloads. `<Stylesheet />` emits hashed graph CSS in
production. In development, it loads the entry and current page's imported CSS
through Vite before the first paint. Vite's injected styles take over as the
client modules load, and Goribu removes the initial stylesheet before the first
hot update, so removed CSS rules do not linger during edits. Keep CSS imports in the client
entry or browser-reachable page modules; no stylesheet URL prop is needed.

Worker-rendered documents receive one request nonce shared by
`responseHeaders`, `Document`, Goribu's scripts, and React streaming
instructions. Static candidates omit it because a reusable asset cannot promise
a per-request value.

## Worker response policy

```js
export default defineConfig({
  name: "my-app",
  compatibilityDate: "2026-08-31",
  responseHeaders({ mode, nonce }) {
    return mode === "production"
      ? {
          "Content-Security-Policy":
            `default-src 'self'; script-src 'self' 'nonce-${nonce}'`,
        }
      : {};
  },
});
```

The callback receives `{ request, env, mode, nonce }` and synchronously returns a
plain object of string or string-array values. Existing response headers win;
`Vary` merges; framework protocol representation headers stay protected. Unsafe
blanket body, redirect, cookie, and transport headers are rejected.

This policy is Worker-only. Static routes bypass the Worker and cannot currently
receive application-defined CSP or other static headers; `public/_headers`
remains reserved for Goribu's generated cache rules: immutable browser assets
and static navigation payloads, and an uncached navigation index.

### Inline scripts and prerendered pages

On a prerendered page `nonce` is `undefined`, and no CSP header reaches the
page. Pass `nonce={nonce}` to your inline scripts anyway. React leaves the
attribute out when the value is `undefined`, so one Document works for both kinds
of page: Worker-rendered pages, including static pages in development, carry the
nonce their CSP allows, and prerendered pages have no CSP to satisfy.

```jsx
<script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
```

Send a CSP through `responseHeaders`. Do not build a
`<meta http-equiv="Content-Security-Policy">` from `nonce` in the Document: on a
prerendered page it would allow only `'nonce-undefined'` and block the page's
inline scripts. A nonce has to be new for every response, and a static file is
the same for everyone, so prerendered pages cannot use one. Until static header
rules exist, set `prerender = false` on a page that must have a CSP.

## Public browser values

For local Worker bindings and production secrets, see
[Environment variables](/docs/environment-variables).

Only `PUBLIC_*` environment values enter `import.meta.env`:

```dotenv
PUBLIC_API_ORIGIN=https://api.example.com
DATABASE_URL=server-only
VITE_LEGACY_VALUE=not-public-in-goribu
```

They follow Vite's mode-specific loading and are embedded as strings. Goribu
rejects user configuration or later plugins that broaden `envPrefix`. Secrets
and Cloudflare bindings stay on `req.env` and in `.server.*` modules.

**Next:** [Static routes](/docs/static-routes).
