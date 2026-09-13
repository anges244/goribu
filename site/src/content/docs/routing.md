---
title: Routing
description: File-based routes, dynamic segments, precedence, and what routing answers on its own.
---

Goribu routes by file. Every file under `src/routes/` becomes a URL, and the
shape of the tree is the routing table — there is no separate route configuration
to keep in sync.

## The routes directory

Routes live in `src/routes/`. A route file default-exports a React component —
the page for that URL — and its path in the tree determines the URL it answers.

```
src/routes/
  index.jsx        →  /
  about.jsx        →  /about
  blog/
    index.jsx      →  /blog
    post.jsx       →  /blog/post
  posts/
    [id].jsx       →  /posts/:id
```

Route files may be `.js`, `.jsx`, `.ts`, or `.tsx`. TypeScript declaration files
(`.d.ts`) are ignored. Symlinked files and directories are not followed.

## From file to URL

- A folder becomes a path segment: `blog/post.jsx` → `/blog/post`.
- A terminal `index` file maps to its folder: `blog/index.jsx` → `/blog`. (A
  folder literally named `index` stays a segment.)
- `src/routes/index.jsx` is the site root, `/`.

## Dynamic segments

Wrap a segment in brackets to capture it. `posts/[id].jsx` matches `/posts/hello`
and `/posts/42` — any single segment — and names the captured value `id`.

```
src/routes/posts/[id].jsx      matches  /posts/anything   (one segment)
```

A parameter name may contain letters, digits, and underscores, and each `[param]`
in one route must have a distinct name.

Reading the captured value needs a request handler, which arrives in a later
release. Until then a dynamic page renders the same for every value — the route
matches, but there is nothing yet to hand it the `id`.

**Not supported (by design):** catch-all (`[...param]`) and optional segments.
Goribu rejects them at build time with a message telling you what is allowed. It
becomes a real feature only when a route needs it.

## Precedence

When more than one route could match a URL, the more specific one wins: a static
segment beats a dynamic one at the same position. So `/posts/new` is served by
`posts/new.jsx`, not `posts/[id].jsx`, whenever both exist. This order is decided
once at build time, not recomputed on every request.

## Conflicts fail the build

Two routes that resolve to the same URL shape are a build error. Parameter names
are labels, not distinguishing constraints, so `posts/[id].jsx` and
`posts/[slug].jsx` collide — both match `/posts/:one-segment`. Rename or remove
one. Catching this at build keeps an ambiguous URL from ever reaching a request.

## Reserved files

Names beginning with `_` are never URLs, and an underscore-prefixed folder
excludes its whole subtree from routing. Goribu uses this namespace for special
files:

- `_document.jsx` — the document shell every page renders inside. See
  [Rendering](/docs/rendering).
- `_404.jsx` — the page rendered for an unmatched URL.

## What a route must export

A route file must export a default React component, one or more named HTTP handlers (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, or `OPTIONS`), or both. A file under `src/routes/` that exports neither is a build error. Handlers answer their matching methods; a default page provides an implicit GET when there is no `GET` handler. See [Handlers](/docs/handlers).

## What routing answers on its own

From the route tree alone — before any handler exists — Goribu answers:

- **GET** of a page → renders the page (see [Rendering](/docs/rendering)).
- **HEAD** → the same status and headers as GET, with no body.
- **OPTIONS** → `204 No Content` with an `Allow` header.
- Any other method → `405 Method Not Allowed` with an `Allow` header.
- An unmatched URL → the `_404` page.
- A trailing slash → a redirect to the canonical, slash-free URL (the root `/`
  excepted). The Worker issues a `308` for the routes it serves; static routes
  are canonicalized by the asset layer.

## See also

- [Rendering](/docs/rendering) — how a matched page becomes a streamed HTML
  response, and the document shell.
- [Static routes](/docs/static-routes) — which routes are served from Static
  Assets without invoking the Worker.

**Next:** [Rendering](/docs/rendering).
