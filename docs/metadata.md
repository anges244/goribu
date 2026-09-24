# Metadata, Document, and browser policy

Goribu keeps related page-boundary responsibilities explicit:

- route modules describe page-specific metadata with `meta`;
- `src/setup/_document.jsx` owns the HTML shell and places framework helpers;
- `responseHeaders()` defines application-wide defaults for Worker responses;
- `PUBLIC_*` values are the only environment values admitted to browser code.

## Route metadata

A page route may export a plain metadata object:

```jsx
export const meta = {
  title: "About",
  description: "How our team builds on Cloudflare.",
  canonical: "https://example.com/about",
  robots: "index,follow",
};

export default function AboutPage() {
  return <main>About us</main>;
}
```

When metadata depends on rendered data or the displayed URL, export a synchronous
function:

```jsx
export function meta({ props: { post }, url }) {
  return {
    title: post.title,
    description: post.summary,
    canonical: new URL(url.pathname, "https://example.com").href,
    meta: [
      { property: "og:type", content: "article" },
      { property: "og:image", content: post.image },
    ],
    links: [
      { rel: "alternate", href: `/fr/posts/${post.slug}`, hrefLang: "fr" },
    ],
  };
}

export async function GET(req, res) {
  const post = await req.env.DB.getPost(req.params.slug);
  return res.render({ post });
}
```

The function receives only `{ props, url }`. Load data in the route handler and
return everything the page and metadata need through `res.render(props)`.
Metadata is resolved and validated before streaming begins, so a failure reaches
the normal error boundary before page bytes commit.

During request-time rendering, `url` is the displayed route URL. Prerendering
uses the build-time route URL; static navigation reuses the saved metadata. A same-page
form render receives the verified Referer URL, including its query. `_404`
receives the missing URL and its props. Production `_500` receives the safe
`{ url, errorId }` props, while its metadata URL omits query and hash.

### Supported fields

| Field | Element |
| --- | --- |
| `title` | `<title>` |
| `description` | `<meta name="description">` |
| `canonical` | `<link rel="canonical">` |
| `robots` | `<meta name="robots">` |

`meta` accepts ordered `{ name, content }` or `{ property, content }` objects.
`links` accepts ordered objects with required string `rel` and `href`, plus
optional string `as`, `type`, `media`, `sizes`, `hrefLang`, `crossOrigin`,
`referrerPolicy`, `fetchPriority`, `imageSrcSet`, `imageSizes`, or `color`.

Unknown keys, event-like fields, non-string values, thenables, and ambiguous
descriptors fail with a `[Goribu]` repair message. `description`, `robots`, and
`canonical` each have one representation and cannot be duplicated in descriptor
arrays. Export only metadata fields; when content front matter also contains
navigation or ordering data, project it into an explicit `meta` object.

Goribu always emits one managed title. Omitting `title` produces an empty title
so navigation cannot retain stale tab text. Each route therefore owns its title;
do not add a competing fallback `<title>` to `Document`.

### Browser synchronization

Route-owned title, meta, and link nodes carry `data-goribu-head`. Navigation and
same-page form renders construct the complete next set, remove the old marked
nodes, and append the new set atomically. Document-owned viewport, icon, preload,
and other unmarked nodes remain untouched.

For a prerendered page, metadata is a build-time snapshot shared by its static
HTML and client navigation data. Changing a query string does not rerun its
server `meta()` function. Use `prerender = false` when metadata must depend on
the current request.

## Document

The built-in shell works without configuration. To customize it, default-export
`src/setup/_document.jsx`:

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

`children` must stay under the fixed `#root` hydration element. Render `head`
inside `<head>`. Render one `<Stylesheet />` and one `<ClientEntry>`; the latter's
explicit source is the development fallback, while production substitutes the
hashed audited entry and adds route-specific module preloads.

`nonce` is available for application-owned inline elements on Worker-rendered
documents. Framework scripts read the same value from render context, so it does
not need to be forwarded to `ClientEntry`.

### Graph-owned styles

Import CSS from `src/setup/client-entry.js` or code reachable from the client route
graph. In production, `<Stylesheet />` emits the hashed CSS resolved for the
entry and current page. In development it emits a render-blocking stylesheet
that follows the entry and current page's static CSS imports through Vite's
live transforms. The first HTML render is styled before browser JavaScript
loads. After the entry and page modules load, Vite's injected styles take over
and Goribu removes the initial stylesheet so removed rules do not survive hot
updates. Client navigation loads the next page's CSS with its module before
rendering it. A source path is not a public prop; the graph is the source of
truth. CSS imported with `?inline`, `?raw`, or `?url` is not automatically applied.

## CSP nonces and response headers

Every request reaching the Worker gets a cryptographically random nonce. For a
Worker-owned document render, that value is shared by:

- `responseHeaders({ nonce })`;
- `Document({ nonce })`;
- Goribu's inert route and props JSON scripts;
- the external client module script;
- React's executable streaming instructions.

Static candidates omit HTML nonces so their generated HTML is deterministic and
does not pretend to have a per-request value.

Define Worker response defaults in `goribu.config.js`:

```js
import { defineConfig } from "goribu/server";

export default defineConfig({
  name: "my-app",
  compatibilityDate: "2026-08-31",
  responseHeaders({ request, env, mode, nonce }) {
    return {
      "Content-Security-Policy":
        `default-src 'self'; script-src 'self' 'nonce-${nonce}'`,
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    };
  },
});
```

The callback sees the original transport `request`, exact Worker `env`, resolved
mode, and nonce. It must synchronously return a plain object whose values are
strings or arrays of strings. Route/framework headers win over these defaults;
`Vary` tokens merge. Protocol responses retain their no-store content type and
cannot regain stale validators, ranges, redirect fields, or edge-cache headers
through global policy.

Blanket `Content-Length`, `Content-Range`, `Content-Encoding`, `Content-Type`,
`Location`, `Set-Cookie`, `Trailer`, and `Transfer-Encoding` are rejected. Set
those through the response or cookie API that owns them.

Goribu defines no default CSP, CORS, or HSTS policy. If the callback itself
fails, the ordinary error boundary responds without invoking the broken policy
again, so that emergency response may lack application headers.

### Static response limitation

`responseHeaders()` runs only when the Worker runs. Prerendered routes and other
Static Assets bypass it. Goribu generates immutable cache rules for hashed
browser assets and static navigation payloads, plus a no-store rule for the
navigation index. App-authored `public/_headers` is rejected to
protect that generated file, so application-defined static CSP and other static
header rules are not supported yet. Do not describe a Worker nonce policy as
covering static pages.

## Public browser environment

For local Worker bindings and production secrets, see
[Environment variables](./environment-variables.md).

Only variables with the exact `PUBLIC_` prefix enter browser code:

```dotenv
PUBLIC_API_ORIGIN=https://api.example.com
DATABASE_URL=server-only
VITE_LEGACY_VALUE=not-public-in-goribu
```

```js
const apiOrigin = import.meta.env.PUBLIC_API_ORIGIN;
```

Values are strings embedded by Vite at build or development-transform time and
follow normal mode precedence (`.env`, `.env.local`, `.env.<mode>`,
`.env.<mode>.local`, and process values). Unprefixed values and legacy `VITE_*`
values stay out of the client environment. Goribu rejects both initial Vite
configuration and later plugins
that broaden `envPrefix`.

Public values are not Worker bindings. Read secrets and Cloudflare resources
from `req.env`, and keep server-only imports in `.server.*` modules.
