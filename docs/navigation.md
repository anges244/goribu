# Navigation

Goribu enhances ordinary anchors after the initial page hydrates. A direct page
request still renders HTML, while an eligible in-app transition asks the Worker
for a small route envelope and loads the matching page module from the client
graph.

Import the public navigation APIs from `goribu`:

```jsx
import { Link, NavLink, navigate } from "goribu";
```

There is no public router store, navigation hook, `<Navigate>`, or imperative
prefetch API.

## Links

`<Link>` renders a real `<a>`, so it remains accessible and navigable before
hydration or when JavaScript fails:

```jsx
<Link href="/posts">Posts</Link>
<Link href="/login" replace>Sign in</Link>
<Link href="/reports" prefetch={false}>Reports</Link>
```

`replace` replaces the current history entry instead of pushing one. Intent
prefetch is enabled by default and can be disabled per link.

Goribu enhances only a same-origin HTTP(S) destination reached by an unmodified
primary click in the current browsing context. These remain browser-owned:

- external URLs and non-HTTP schemes such as `mailto:`;
- downloads and non-`_self` targets;
- middle clicks and clicks with Meta, Ctrl, Shift, or Alt;
- same-document hash links and exact-current-URL links;
- malformed destinations;
- a click whose application `onClick` called `preventDefault()`.

Application handlers run first. When a click is not enhanced, the real anchor
performs the normal document navigation.

## Active links

`<NavLink>` adds pathname-based active state:

```jsx
<NavLink
  href="/settings"
  className={({ isActive }) => (isActive ? "active" : undefined)}
>
  Settings
</NavLink>

<NavLink href="/settings/profile" end>
  Profile
</NavLink>
```

An active link receives `aria-current="page"`. Matching ignores query and hash,
normalizes one trailing slash, and respects segment boundaries: `/posts`
matches `/posts/42`, not `/postscript`. `end` requires an exact pathname match,
and `/` is always exact-only. Goribu owns `aria-current`; do not use it as a
second active-state channel.

## Imperative navigation

Use `navigate()` only when there is no meaningful anchor:

```jsx
<button onClick={() => void navigate("/dashboard")}>Continue</button>
<button onClick={() => void navigate("/login", { replace: true })}>
  Sign in again
</button>
```

`navigate(target, { replace? })` returns a Promise. After hydration, a
same-origin HTTP(S) destination uses enhanced navigation. Before bootstrap, or
for a cross-origin HTTP(S) URL, it performs a full document navigation. Invalid,
empty, non-HTTP, and non-browser calls fail with a `[Goribu]` repair message.

Prefer `<Link>` for navigation users may open in another tab, copy, or reach
without JavaScript.

## Worker protocol

Enhanced transitions fetch only Goribu's reserved endpoint:

```text
GET /_goribu/worker-nav?to=%2Fposts%2F42%3Fview%3Dfull
```

The target goes through ordinary GET matching, middleware, handlers, cookies,
`req.env`, and `req.waitUntil`. The no-store result is one of three internal
envelopes:

```js
{ kind: "render", routeId, props, meta, status }
{ kind: "redirect", location, status }
{ kind: "reload" }
```

A render loads the canonical route page chunk before committing history or UI.
Redirects stay explicit so Goribu can preserve application redirect semantics.
A reload means the target cannot safely become a hydrated page, such as an API
response, `_404`, or error page, so the browser requests the full document.

This endpoint is framework-internal. Do not call or route `/_goribu/` yourself.

## History, scrolling, and concurrency

A successful transition pushes one history entry by default. `replace` changes
the current entry, redirect chains commit only the final destination, and
back/forward traversal reuses its existing entry.

Goribu preserves application-owned `history.state` fields and stores its own
scroll data under a private key. New routes scroll to a matching fragment or the
top; back and forward restore saved coordinates. Same-document hash links remain
native so browser focus behavior is preserved.

A newer navigation invalidates older pending work. If an envelope, page module,
metadata set, render, history operation, or redirect chain cannot be validated,
Goribu loads the target document instead of committing partial client state.

## Intent prefetch

`<Link>` prefetches only destinations that would be eligible for enhancement:

- pointer hover waits briefly, and leaving before the delay cancels it;
- primary pointer down starts immediately;
- a following navigation shares the in-flight request;
- completed entries expire quickly and the cache is bounded;
- failures are discarded so the real click retries.

Prefetch is an optimization, never a correctness requirement.

## Related APIs

GET `<Form>` submissions use this same navigation controller. POST, PUT, PATCH, and DELETE forms can
redirect into it or render the current page in place. See [forms.md](./forms.md).

Route metadata is validated before a transition commits, then only Goribu's
marked route-owned head nodes are replaced. See [metadata.md](./metadata.md).
