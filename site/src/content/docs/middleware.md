---
title: Middleware
description: Folder-scoped middleware with no next — return nothing to continue, a res.* result to stop.
---

Middleware is code that runs **before** a route's handler or page. You put it in a
file, it applies to a folder, and it either lets the request continue or answers
it early. There is no `next` — a middleware returns nothing to continue, or a
`res.*` result to stop.

```js
// src/routes/dashboard/_middleware.js
export default function requireSession(req, res) {
  if (!req.cookies.get("session")) {
    return res.redirect("/login");   // stop here — the route never runs
  }
  // return nothing → continue to the next middleware, then the route
}
```

Everything under `src/routes/dashboard/` now requires a session cookie, checked
before any of those routes runs.

## Where middleware lives

One file named `_middleware` per directory — `_middleware.js`, `.jsx`, `.ts`, or
`.tsx`. It applies to that directory and **everything beneath it**. Two
`_middleware` files in the same directory is a build error. Like all `_`-prefixed
files, it is never itself a URL.

```
src/routes/
  _middleware.js            → applies to every route
  dashboard/
    _middleware.js          → applies to /dashboard and everything under it
    index.jsx
    settings.jsx
```

## What a middleware receives and returns

The signature is the handler signature — `(req, res)` — and middleware shares the
**same** `req` and `res` as the route it precedes. So a middleware can read
`req.cookies`, `req.query`, `req.env`; set a cookie or header the route's response
will carry; or end the request with any terminal response.

- **Return nothing** (`undefined`) → continue to the next middleware, then the
  route's handler or page.
- **Return a `res.*` result** → stop. That result becomes the response; the route
  never runs. Anything works — `res.redirect(...)`, `res.json(...)`,
  `res.render(...)`, `res.notFound(...)`.

Returning a raw `Response` or a bare value is a mistake Goribu catches — return a
`res.*` result so cookies and other framework behavior still apply. Headers and
cookies a continuing middleware set are kept when the route renders, and are even
applied to a short-circuit response.

## Order: outermost first

When several `_middleware` files apply to a route, they run **outermost to
innermost** — the shallowest folder first, down to the route's own directory:

```
src/routes/_middleware.js              runs 1st
src/routes/dashboard/_middleware.js    runs 2nd
src/routes/dashboard/settings.jsx      ← the route
```

A single `_middleware` file may export an **array** instead of one function; those
run left to right, in the position of that file in the chain:

```js
export default [logRequest, requireSession, loadTeam];   // in this order
```

The first middleware to return a `res.*` result wins and stops the chain; nothing
after it runs.

## Middleware makes a route Worker-served

A page with no server work can be served straight from Static Assets, never
touching the Worker (see [Static routes](/docs/static-routes)). Middleware runs
**per request**, so a route with any middleware in its ancestry can't be static —
it's served by the Worker so the middleware actually runs. The build says so out
loud, naming the middleware, and downgrades that route from static output. Forcing
`export const prerender = true` on a route that also has middleware fails the
build.

The practical consequence: **scope middleware narrowly.** A `_middleware` at the
top of `src/routes/` applies to every route and makes the whole app Worker-served;
put it on the subtree that needs it.

## What middleware does *not* run for

Middleware runs for a **matched** route — a page or a handler. It does not run for
the framework's own mechanical answers: the `_404` for an unmatched URL, an
automatic `OPTIONS`, or a `405`.

## See also

- [Handlers](/docs/handlers) — the `req`/`res` surface middleware shares with a route.
- [Errors](/docs/errors) — a middleware that throws hits the same error boundary.
- [Static routes](/docs/static-routes) — why middleware forces a route onto the Worker.

**Next:** [Errors](/docs/errors).
