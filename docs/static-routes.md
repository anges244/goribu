# Static routes

Some routes never need the Worker to answer them. If a page's first response is
the same for everyone and can be produced ahead of time, Goribu renders it once
at build and serves it from Static Assets — Cloudflare's CDN — so the Worker is
never invoked for that URL.

This is not a separate "prerender feature" you turn on. Static output is simply
what the build does when a route's first response needs no Worker.

## Two independent things

Two questions are easy to run together, and Goribu keeps them apart:

- **Where does the response come from?** A static asset, or the Worker.
- **Does the browser run JavaScript for it?** Every route hydrates (from Block
  5); that is a separate axis.

A "static" route is only a statement about the first question. A page with no
server work and a `useState` counter is served statically *and* hydrates in the
browser — both are true at once. Static never means "no JavaScript." (A
route-level opt-out of hydration is a possible future feature, not part of this
version.) See [decisions.md](./decisions.md).

## What makes a route static

A route is served statically when both hold:

1. **Its GET representation needs no Worker.** The route has a page and no GET
   handler, has not set `prerender = false`, and has no selected middleware.
   POST-only handlers do not prevent the page's GET from being static.
2. **Its URL is fully known at build time.** A route with a dynamic segment
   (`posts/[id]`) has no single URL to build, so it cannot be static.

You can be explicit with a `prerender` export:

```jsx
export const prerender = false; // always serve this route from the Worker
export const prerender = true;  // require this route to be built statically
```

`prerender = true` is a promise: if the route cannot be built statically, the
build fails rather than quietly serving it from the Worker.

## How it works

`goribu build` produces the Worker and client bundles, then runs the **built
Worker itself** in the Workers runtime and asks it for each static route. The
HTML it returns — exactly what the Worker would serve at request time — is
written into the client asset directory. Cloudflare then serves that file
directly, and the Worker is never invoked for the URL.

Because the static file is produced by the real Worker, a static route and a
dynamic one render through the same code and the same document shell; there is no
second rendering path to drift.

## Downgrades are loud

When a prerender candidate can't be made static, the build says so by name and
falls back to serving it from the Worker:

```
[Goribu] Route "src/routes/posts/[id].jsx" (/posts/:id) is a prerender candidate
but was not statically output: it has a dynamic segment (:id) whose URL is not
known at build time. It will render on the Worker at request time.
```

A route is downgraded when it has a dynamic segment, selected middleware, or the
Worker cannot render it at build time. A route that *forced* `prerender = true`
fails the build instead of downgrading — it asked for a guarantee it could not
keep.

## Assets and routes cannot collide

Static Assets take precedence over the Worker, so a file you publish under
`public/` that sits at a route's URL would shadow that route. The build refuses
it: if a published HTML file resolves to a URL a route owns, the build fails and
names the file and the route. Rename or remove one.

## Verifying it

The payoff of a static route is that it costs no Worker invocation, and that is
measured, not assumed. After a deploy, hitting a static route does not increment
the Worker's invocation count, while a dynamic route does. That check against
real invocation counts is what closes this capability — the build output alone is
not taken as proof.

## See also

- [routing.md](./routing.md) — how URLs map to routes.
- [rendering.md](./rendering.md) — how a page renders to HTML.
- [decisions.md](./decisions.md) — the two axes, and the static-output render
  path.
