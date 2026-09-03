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
clicks, same-document fragments, exact-current URLs, and a cancelled `onClick`
remain browser-owned.

`replace` replaces the current history entry. Intent prefetch is enabled by
default; hover waits briefly, pointer down starts immediately, and
`prefetch={false}` disables it. Prefetch is bounded and optional: failure never
changes what a click does.

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

Goribu asks `/_goribu/worker-nav` for a no-store render, redirect, or reload
envelope. The target still runs through normal GET routing, middleware, handlers,
cookies, and Worker bindings. A render loads the route's canonical page chunk
before history or UI commits. A reload means the response cannot safely become a
client page, so the browser requests the document.

A newer navigation invalidates older work. Any malformed envelope, missing page
module, failed render, unsafe redirect, or history failure falls back to the
document rather than leaving partial client state.

Goribu pushes one history entry by default, preserves application fields in
`history.state`, restores scroll on back/forward, and scrolls new routes to a
fragment or the top. Same-document hash links remain native.

**Next:** [Forms](/docs/forms).
