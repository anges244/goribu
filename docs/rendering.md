# Rendering

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

The default shell is minimal:

```html
<html>
  <head><meta charset="utf-8"></head>
  <body><div id="root"><!-- your page --></div></body>
</html>
```

That `<div id="root">` is the mount point where Block 5's client runtime will
hydrate.

## Customizing the document

To control the document yourself, add `src/routes/_document.jsx` with a
default-exported component. It receives the rendered page as `children` and is
responsible for the same three elements:

```jsx
export default function Document({ children }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>My app</title>
      </head>
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  );
}
```

The Document is a **file in the route graph**, not a field in
`goribu.config.js`. Configuration is plain data that Node loads directly; a
Document is a React component, so it lives where it can be compiled, styled, and
(from Block 5) audited for the client boundary. `goribu.config.js` rejects a
`Document` field with a message pointing you here. See
[decisions.md](./decisions.md).

Later blocks extend what the Document receives (metadata for `<head>`, a
hydration nonce). An existing Document keeps working across those additions
because it simply ignores props it does not read.

## What a page receives

In this block a page renders with no props. Route parameters (the `id` from
`posts/[id]`) and loaded data reach a page only through a request handler, which
arrives in a later block. Until then a page is a pure function of nothing — which
is exactly what makes most pages [static](./static-routes.md).

## The not-found page

A URL that matches no route renders a not-found page with a `404` status,
through the same shell as any other page. Supply your own by adding
`src/routes/_404.jsx`; without one, Goribu streams a plain built-in page.

## When rendering can't proceed

If a route's default export — or a custom Document — is not a React component,
the build (or the render) fails with a `[Goribu]` message naming the file and
what to export. A request error boundary (`_500`) is part of a later block; this
block renders pages, the not-found page, and the automatic method responses that
[routing](./routing.md) answers on its own.

## See also

- [routing.md](./routing.md) — how a URL matches a page.
- [static-routes.md](./static-routes.md) — rendering a route once at build time
  instead of on every request.
