---
title: Introduction
description: What Goribu is and the two ideas that shape it.
---

Goribu is a React framework for Cloudflare Workers where the platform's own
primitives are first-class rather than adapted, and where a real app goes from
one command to a public URL.

This page is itself a Goribu route. It is a Markdown file compiled to a React
component at build time, rendered through the same streaming SSR pipeline as
every other page, and served — because it does no per-request work — as a static
asset without invoking the Worker at all.

## The happy path is server-rendered and hydrated

Interactive routes require JavaScript. This is a decision, not an accident. Every
route is server-rendered, and every route hydrates in the browser. A route-level
opt-out to HTML only is a real feature, and it is deliberately left for later, so
that "static" never quietly comes to mean "no JavaScript".

## Two axes, kept separate

Two questions about a page are independent and must not be collapsed into one:

- **Where does the initial response come from** — a static asset, or the Worker?
- **What runs in the browser** — HTML only, or a hydrated bundle?

A **static route** is one whose initial response can be produced entirely at
build time and served from Static Assets without invoking the Worker. Whether
that response also loads a client bundle is a separate question with a separate
answer. A page with no server work and a `useState` counter is static *and*
hydrated, and both halves of that are true at once.

## One implementation until there is a second

No adapter layers, no shared interfaces, no foundations built to serve a case
that does not exist yet. When a second case shows up, the abstraction gets
designed with two real examples in hand.

**Next:** [Getting started](/docs/installation).
