---
title: Errors
description: Two error boundaries — development disclosure and a production _500 with a correlation ID — plus the 400 for a bad request body.
---

When something in a request throws, Goribu catches it at the edge of the request
and turns it into a response — so a bug in one handler becomes one failed request,
not a crashed Worker. What that response looks like depends on whether you're
running in development or production.

## Two boundaries, one rule

The rule is the same in both modes: **a thrown error never leaks raw detail to a
production visitor, and always gives you enough to debug locally.**

**In development** (`goribu dev`), a thrown error is disclosed. The response is a
`500` in plain text with the error's message and stack, so you see exactly what
broke while you're building.

**In production** (`goribu deploy`), a thrown error renders your `_500` page with a
**correlation ID**. The raw error never reaches the HTML; instead Goribu logs the
error against that ID, and shows the same ID on the page. A visitor reports "error
`b3f1c2…`", you find that ID in your logs, and you have the full error — without
ever exposing it.

```
Production /some-broken-route  →  500, your _500 page, "Error ID: b3f1c2a0-…"
Logs                            →  [Goribu] Unhandled error b3f1c2a0-…: <the real error>
```

## The `_500` page

Add an optional `src/routes/_500.jsx`, alongside `_404.jsx`, and it renders for
unhandled production errors. It's a normal React component and receives two props:

```jsx
// src/routes/_500.jsx
export default function ServerError({ url, errorId }) {
  return (
    <main>
      <h1>Something went wrong</h1>
      <p>We hit an error on <code>{url}</code>.</p>
      <p>Reference: <code>{errorId}</code></p>
    </main>
  );
}
```

- **`url`** is the request **pathname only** — never the query string, so secrets
  in a URL can't leak into the error page.
- **`errorId`** is the correlation ID, matching the logged entry.

Without an `_500.jsx`, Goribu renders a minimal built-in page that still shows the
ID. If the `_500` page *itself* throws while rendering, Goribu falls back to a
plain-text `500` carrying the same ID — the error path can't itself fail to
respond.

## Client errors are different — the `400`

Not every failure is a server error. When a request sends a body Goribu can't
parse — broken JSON, a `multipart/form-data` body with no boundary — that's the
*client's* mistake, and `req.body()` produces a **`400`** with a short, safe
message, in both development and production:

```
POST /api  (content-type: application/json, body: "{ broken")
  →  400  [Goribu] Could not parse the application/json request body. Send valid JSON.
```

A `400` is not logged as an unhandled error and gets no correlation ID — it's an
expected answer to a bad request, not a bug. See [Handlers](/docs/handlers).

## What the boundary covers

The boundary catches throws on the **request path** — from a handler, a
middleware, or while rendering a page. It runs after routing, so cookies a
middleware queued before the throw are still applied to the error response.

It does **not** swallow setup mistakes. Errors from building the app — a route with
no valid export, misconfigured middleware — surface at build or startup, loudly,
where they belong.

## Verifying both boundaries

Because the deployed Worker always runs in production mode, you confirm each half
in its own place: development disclosure with `goribu dev`, and the production
`_500` + correlation ID after `goribu deploy` (with the same ID visible in your
log stream).

## See also

- [Handlers](/docs/handlers) — the `400` from `req.body()` on a malformed body.
- [Middleware](/docs/middleware) — a middleware throw hits this same boundary.
- [Routing](/docs/routing) — `_404`, the sibling of `_500`, for unmatched URLs.

**Next:** [Navigation](/docs/navigation).
