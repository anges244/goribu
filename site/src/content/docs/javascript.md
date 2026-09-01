---
title: JavaScript
description: Which routes need JavaScript, which don't, and why.
---

Goribu keeps two questions about a page separate, and this page is about the
second one:

- **Where does the initial response come from** — a static asset, or the Worker?
  That is the subject of [Static routes](/docs/static-routes).
- **What runs in the browser** — plain HTML, or a hydrated React app? That is
  this page.

The two are independent. A page can be served statically *and* run JavaScript in
the browser; a page can be served by the Worker and run no JavaScript at all.
"Static" is never a statement about the browser.

## The position

The happy path is **server-rendered and hydrated**. Every route renders to HTML
on the server, and — by design — every route also hydrates in the browser, so an
interactive route has the JavaScript it needs. Interactivity requires JavaScript.
That is a decision, not an accident, and Goribu documents it as one rather than
pretending pages stay interactive without it.

A route-level opt-out to **HTML only** — a page that ships no client bundle at all
— is a real, wanted feature, and it is deliberately left for later. Keeping it out
for now means "static" can never quietly drift into meaning "no JavaScript": the
two axes stay separate because the browser axis has exactly one setting today.

## Which routes need JavaScript right now

Honestly: **none of them do yet.** The browser runtime — hydration, client-side
navigation, forms — is a later block. Until it lands, every Goribu route is
server-rendered HTML and nothing runs in the browser.

This documentation site is the proving ground for that state. Every page you are
reading is:

- **Server-rendered** through the streaming SSR pipeline (see
  [Rendering](/docs/rendering)),
- **Statically output** at build time, so it is served from Static Assets and the
  Worker is never invoked (see [Static routes](/docs/static-routes)),
- and **HTML only** — no client bundle does any work, because there is nothing
  interactive on these pages to hydrate.

So the site sits at one corner of the two axes: static request, HTML browser. When
hydration ships, the interesting corner opens up — a statically served route that
also hydrates — and both halves will be true of the same page at once. This page
will be updated then to show it, not before.

**Next:** [Deploying](/docs/deploy).
