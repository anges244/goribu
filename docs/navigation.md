# Navigation

Goribu enhances ordinary anchors after the initial page hydrates. A direct page
request receives HTML. In production, an eligible transition to a successfully
prerendered page loads saved route data from Static Assets without invoking the
Worker. Dynamic transitions ask the Worker for route data. Both load the matching
page module from the client graph.

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
- same-document hash links;
- malformed destinations;
- a click whose application `onClick` called `preventDefault()`.

Application handlers run first. When a click is not enhanced, the real anchor
performs the normal document navigation.

After hydration, clicking the exact current URL scrolls to the top. A confirmed
static page preserves its component state without fetching or rerendering. A
dynamic page requests fresh route data, bypassing prefetched data, and updates
in place. Neither adds a history entry or deliberately reloads the document.
`NavLink` and `navigate()` use the same rule. Fragment links remain native.

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

## Static navigation

Production bootstrap reads one uncached, build-identified static navigation
index. Only pages whose HTML and navigation payload were successfully written
appear in it. Prefetch, links, imperative navigation, redirects into static
pages, and back/forward traversal all use these saved payloads. JavaScript and
CSS still load as needed; avoiding Worker execution does not mean avoiding all
asset requests.

Static HTML and route data share the exact same build-time props and metadata.
This includes explicitly prerendered GET handlers: client navigation does not
rerun them. Query strings remain in the address bar but do not recompute static
server props or metadata. Use `prerender = false` for request-dependent output.

Development keeps using the Worker because no production snapshots exist yet.
Build or data mismatches, missing assets, and invalid payloads fall back to a
document load. Deploy the complete output of `goribu build` together.

## Worker protocol

Dynamic transitions fetch Goribu's reserved endpoint:

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
back/forward traversal reuses its existing entry. Exact-current-URL navigation
reuses the current entry too.

The static scroll-only behavior requires the destination to match both the
address bar and the displayed page. If Back or Forward is still loading,
clicking a link to the page still on screen navigates to that URL normally.

Goribu preserves application-owned `history.state` fields and stores its own
scroll data under a private key. New routes scroll to a matching fragment or the
top; back and forward restore saved coordinates. Same-document hash links remain
native so browser focus behavior is preserved.

For a page transition, Goribu applies scrolling after React commits the
destination and finishes synchronous layout updates, before the browser paints
it. This prevents a frame of the new page at the old page's scroll position.
In-place Form renders preserve scrolling and component state. Content that
arrives later, such as images or asynchronously revealed sections, can still
change the page's layout.

A newer navigation invalidates older pending work. If an envelope, page module,
metadata set, render, history operation, or redirect chain cannot be validated,
Goribu loads the target document instead of committing partial client state.

If recovery targets the URL already in the address bar, Goribu removes its
fragment to force a document GET, preserving the query. A render failure after
history has accepted the destination replaces that entry, so Back does not land
on an extra failed transition. Ordinary fragment navigation is unchanged.

## Intent prefetch

`<Link>` prefetches only destinations that would be eligible for enhancement:

- pointer hover waits briefly, and leaving before the delay cancels it;
- primary pointer down starts immediately;
- a following navigation shares the in-flight request;
- completed entries expire quickly and the cache is bounded;
- failures are discarded so the real click retries.

Exact-current-URL links do not prefetch. Static prefetch uses Static Assets;
dynamic prefetch uses the Worker protocol.

Prefetch is an optimization, never a correctness requirement.

## Related APIs

GET `<Form>` submissions use this same navigation controller. POST, PUT, PATCH, and DELETE forms can
redirect into it or render the current page in place. See [forms.md](./forms.md).

Route metadata is validated before a transition commits, then only Goribu's
marked route-owned head nodes are replaced. See [metadata.md](./metadata.md).

## Framework regression checks

The React commit tests use hydration and actual React updates, holding animation
frames pending to verify scrolling already matches the destination. The browser
check samples route identity, scroll coordinates, anchor geometry and code styles
on each frame. With Node 22+, pnpm and an already installed Chrome/Chromium:

```sh
pnpm exec vitest run packages/goribu/tests/navigation-commit.test.js packages/goribu/tests/render-recovery.test.js packages/goribu/tests/create-navigation-controller.test.js packages/goribu/tests/form.test.js --maxWorkers=1
node scripts/check-navigation-paint.js /path/to/chrome
```

The browser check bundles its fixture in memory and fulfills requests through
Chrome's debugging protocol. It starts no application server, installs nothing,
and writes its report to a temporary directory. It covers top and fragment
navigation, history, replace, newer navigation, synchronous layout updates,
and actual Form transitions without mutation replay. Recovery checks count
document GETs and verify a new document, action queries, history behavior, Form
removal before a layout error, and newer navigation taking precedence. They
include a document error response: a
GET can still fail, but recovery must not automatically repeat it. The browser
check supplements production integration tests; it does not exercise Worker or
Static Assets delivery.
