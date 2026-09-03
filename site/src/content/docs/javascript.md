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

The two are independent architectural concerns. Serving a page statically does
not imply that it runs without JavaScript, and serving it from the Worker does
not itself require browser JavaScript. "Static" is never a statement about the
browser. Goribu's current browser policy is described below.

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

## What runs now

Every route hydrates. The landing page proves the combination directly: `/` is
statically output and served without a Worker invocation, then its "Why Goribu?"
control becomes interactive through React hydration. Static request, interactive
browser - both are true.

Documentation links use client navigation after hydration, with real anchors as
their no-JavaScript baseline. The [feedback form](/feedback) is a real native
POST before hydration and gains validation, preview, and redirect behavior after
the client runtime installs.

Goribu fails closed at the browser boundary. Route modules are loaded by canonical
ID, `.server.*` code is rejected from the client graph, only `PUBLIC_*`
environment values are exposed, and an uncertain navigation or form protocol
falls back to a document load.

See [Navigation](/docs/navigation), [Forms](/docs/forms), and
[Metadata & Document](/docs/metadata).

**Next:** [Deploying](/docs/deploy).
