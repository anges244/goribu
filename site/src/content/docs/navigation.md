---
title: Navigation
description: Links, active state, history, scroll restoration, prefetch, and safe document fallback.
---

Goribu enhances real anchors after hydration. Import the public navigation APIs
from `goribu`:

```jsx
import { Link, NavLink, navigate } from "goribu";
```

There is no public router store, navigation hook, `<Navigate>`, or imperative
prefetch API.

## Links

`<Link>` renders a real `<a>`, so it still works before JavaScript loads:

```jsx
<Link href="/posts">Posts</Link>
<Link href="/login" replace>Sign in</Link>
<Link href="/reports" prefetch={false}>Reports</Link>
```

An eligible click is an unmodified primary click to a same-origin HTTP(S) URL in
the current browsing context. External URLs, downloads, other targets, modified
clicks, same-document fragments, and a cancelled `onClick`
remain browser-owned.

`replace` replaces the current history entry. Intent prefetch is enabled by
default; hover waits briefly, pointer down starts immediately, and
`prefetch={false}` disables it. Prefetch is bounded and optional: failure never
changes what a click does.

Clicking the exact current URL scrolls to the top. In production, a confirmed
static page preserves component state without fetching or rerendering. A dynamic
page requests fresh route data and updates in place. Neither adds a history
entry or deliberately reloads the document. Exact-current-URL links do not
prefetch. `NavLink` and `navigate()` share these semantics.

## Active links

`<NavLink>` derives active state from the current pathname:

```jsx
<NavLink
  href="/settings"
  className={({ isActive }) => (isActive ? "active" : undefined)}
>
  Settings
</NavLink>
```

Active links receive `aria-current="page"`. Query and hash are ignored, segment
boundaries are respected, and `end` requests an exact pathname match. The root
path is always exact-only.

## Imperative navigation

Use `navigate()` when there is no meaningful anchor:

```jsx
<button onClick={() => void navigate("/dashboard")}>Continue</button>
```

`navigate(target, { replace? })` returns a Promise. Same-origin destinations use
the hydrated runtime; before bootstrap and for cross-origin HTTP(S), Goribu loads
the full document. Invalid or non-HTTP targets fail with a repair message.

## What happens during a transition

In production, successfully prerendered pages load saved route data from Static
Assets without executing the Worker. This applies to prefetch, links, imperative
navigation, redirects into static pages, and back/forward traversal. Page chunks
and stylesheets still load as needed.

The browser reads one uncached static navigation index tied to its build. Saved
route data shares the exact props and metadata embedded in the prerendered HTML.
Explicitly prerendered GET handlers do not rerun on client navigation, and query
strings do not recompute static server data or metadata. Use `prerender = false`
when the output must depend on a request. Development uses the Worker because
there are no production snapshots yet.

For dynamic pages, Goribu asks `/_goribu/worker-nav` for a no-store render,
redirect, or reload envelope. The target runs through normal GET routing, middleware, handlers,
cookies, and Worker bindings. A render loads the route's canonical page chunk
before history or UI commits. A reload means the response cannot safely become a
client page, so the browser requests the document.

A newer navigation invalidates older work. Any malformed envelope, missing page
module, mismatched build, missing snapshot, failed render, unsafe redirect, or history failure falls back to the
document rather than leaving partial client state.

When recovery targets the URL already in the address bar, Goribu removes its
fragment to force a document GET and preserves the query. If history already
accepted the destination before its render failed, recovery replaces that entry
instead of adding another one. Ordinary fragment navigation is unchanged.

Goribu pushes one history entry by default (reusing the current entry for an
exact-current-URL navigation), preserves application fields in
`history.state`, restores scroll on back/forward, and scrolls new routes to a
fragment or the top. Same-document hash links remain native.

Page transitions apply scrolling after React commits the destination and
finishes synchronous layout updates, before the browser paints it. The new page
does not briefly appear at the previous page's scroll position. In-place Form
renders preserve scrolling and component state. Content that arrives later,
such as images or asynchronously revealed sections, can still change layout.

The static scroll-only behavior requires the destination to match both the
address bar and the displayed page. If Back or Forward is still loading,
clicking a link to the page still on screen navigates to that URL normally.

**Next:** [Forms](/docs/forms).
