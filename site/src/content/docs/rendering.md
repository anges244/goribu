---
title: Rendering
description: Streamed server rendering and the document shell.
---

When a request matches a page, Goribu renders that page to HTML on the server and
streams it back. This page covers how a page becomes a response and how the
document around it is shaped.

## Server-side rendering, streamed

A matched page renders inside the document shell and streams to the browser as
React produces it, rather than being buffered whole first. The Worker starts
sending HTML as soon as the shell is ready, so the browser can begin parsing —
and fetching assets — before the whole document exists. Every rendered response
carries `Content-Type: text/html; charset=utf-8`.

A `HEAD` request renders the same way but its body is dropped: it returns the
status and headers of the equivalent `GET` with no content.

## The document shell

Goribu owns the outer HTML document — the `<html>`, `<head>`, and `<body>` — so
every route produces one consistent, valid page. Your page component renders as
the document's body content.

The default shell includes metadata, graph styles, the hydration root, inert
render data, and the client entry. To control placement, add
`src/setup/_document.jsx` (or `.tsx`). This file is optional;
`src/setup/client-entry.js` remains required with either shell:

```jsx
import { ClientEntry, Stylesheet } from "goribu";

export default function Document({ children, head }) {
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

The Document is a **file in the application module graph**, not a field in `goribu.config.js`.
Configuration is plain data that Node loads directly; a Document is a React
component, so it lives where it can be compiled, styled, and audited for the
client boundary. `goribu.config.js` rejects a `Document` field with a message
pointing you here.

Keep `children` inside `#root`, render the route-owned `head` in `<head>`, and
place one of each helper. Worker-rendered documents also receive `nonce` for
application-owned inline elements; on prerendered pages it is `undefined`. See
[Metadata & Document](/docs/metadata#inline-scripts-and-prerendered-pages).

## What a page receives

A page without a GET handler receives no props. A GET handler loads request data
and returns `res.render(props)` to pass it to the page. The same props feed route
metadata and the browser hydration payload. See [Handlers](/docs/handlers).

## The not-found page

A URL that matches no route renders a not-found page with a `404` status, through
the same shell as any other page. Supply your own by adding `src/routes/_404.jsx`;
without one, Goribu streams a plain built-in page.

## See also

- [Routing](/docs/routing) — how a URL matches a page.
- [Static routes](/docs/static-routes) — rendering a route once at build time
  instead of on every request.

**Next:** [Handlers](/docs/handlers).
