# Cache

`req.cache` stores JSON values in Cloudflare's Cache API to avoid repeating
expensive reads or computation. It needs no binding or configuration and is
available in handlers and middleware.

```js
// src/routes/polls.js
export async function GET(req, res) {
  const key = "/polls/recent:v1";
  let polls = await req.cache.get(key);
  if (polls === null) {
    polls = await req.d1`SELECT id, title FROM polls ORDER BY id DESC LIMIT 20`.all();
    await req.cache.set(key, polls, { ttl: 300 });
  }
  return res.json({ polls });
}
```

Check misses with `=== null`; `false`, `0`, and empty strings are valid cached
values. Storing `null` is allowed but cannot be distinguished from a miss.
Use an object such as `{ found: false }` when caching an absent result matters.

## The three operations

| Call | Behavior |
|---|---|
| `get(key)` | Returns the parsed JSON value, or `null` on a miss or cache failure. |
| `set(key, value, { ttl }?)` | Attempts to store JSON with a freshness lifetime in seconds; defaults to 60. |
| `delete(...keys)` | Attempts to remove the supplied keys in the current data center. |

`set` and `delete` resolve to `undefined`. They do not guarantee persistence or
global invalidation. Entries may be evicted before their TTL expires, and
Cloudflare may decline a write even when it resolves successfully.
[Cloudflare Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/),
[cache retention](https://developers.cloudflare.com/cache/concepts/retention-vs-freshness/).

TTL must be a positive safe integer. Zero, fractional, negative, non-finite, and
non-number values are rejected. There is no permanent setting. The only option
is `ttl`; unknown options are rejected rather than silently ignored.

Values use ordinary `JSON.stringify`/`JSON.parse` semantics: dates become strings,
undefined object properties are omitted, and non-finite numbers become `null`.
Circular values, BigInts, and top-level values that produce no JSON (such as
`undefined`, functions, and symbols) are rejected. There is no custom serializer.

TypeScript callers can describe the stored JSON with
`await req.cache.get<Poll[]>(key)`, returning `Poll[] | null`. This type argument
does not validate the stored value; without it the result is `unknown`.

## Keys and scope

Keys are valid Unicode strings starting with `/`, such as `/polls/42`.
They are literal identifiers: `/polls/../42`, `/42`, `/42#summary`, and `/42?full`
remain distinct. They need not identify an actual route.

Entries are shared across requests to the same origin within a data center.
Different schemes, hosts, or ports have separate entries. Goribu uses a dedicated
named cache separate from the default HTTP cache, so storing a value does not
publish it at that URL or change response cache headers.

All users on an origin share these keys. Include the user or tenant identifier
when caching personalized data, and perform authorization before reading it.
Use versioned keys when changing the stored JSON shape across deployments.

`req.cache` works on custom domains, routes, and `*.workers.dev`. Goribu verified
real cache hits on a custom domain and a `workers.dev` deployment on 2026-10-02.
[Cloudflare documents](https://developers.cloudflare.com/workers/runtime-apis/cache/)
that cache operations have no effect in dashboard/Playground previews and are
unavailable behind Cloudflare Access.

An unsupported host can accept writes and return misses without any warning,
so check for real hits on the deployment where caching matters.

## Refresh after mutations

After a successful database mutation, invalidate the affected entries:

```js
await req.cache.delete("/polls/recent:v1", `/polls/${id}`);
```

If the mutation already produced the updated value, `set` can replace the local
entry instead. Keep the authoritative database result for confirmation rather
than depending on a cache reread. Concurrent fills can race with mutations;
these operations do not form a transaction or coordinate concurrent requests.

Cloudflare's Cache API is local to the data center executing the Worker. A
deletion there does not invalidate another location's copy. Choose a TTL that
matches the staleness the app can tolerate; neither these operations nor
[KV](kv.md) provides global strong consistency.
[Cloudflare cache locality](https://developers.cloudflare.com/workers/reference/how-the-cache-works/#cache-api).

### Smart Placement

Smart Placement can improve cache reuse and refresh behavior for localized apps
by concentrating more reads and mutations near the app's data. When those
requests reach the same execution location, they share the same local cache and
its updates. This is useful even though placement does not guarantee that every
request reaches one location: other locations still rely on their own updates
or TTL expiry. Turn it on with `wrangler.placement`; see
[placement](wrangler.md#placement).

## Background writes and failures

To let the response proceed without waiting for a cache fill, use the existing
background-work capability:

```js
req.waitUntil(req.cache.set("/polls/recent:v1", polls, { ttl: 300 }));
```

Ordinary calls never schedule background work automatically. Await a deletion
when the handler should wait for its local attempt to complete.

Invalid keys, values, and options reject with actionable `[Goribu]` errors.
All keys in a deletion batch are validated before any deletion begins. Platform
failures and unreadable cache entries produce a warning and degrade to a miss
or skipped write/delete, so an optional cache failure does not fail the request.
In a runtime without the Cache API, reads miss and writes/deletes do nothing;
argument validation still runs. Tests that need actual storage should run in
the local Worker runtime.

## Static pages

A route with a handler normally runs on the Worker. When explicitly prerendering
a route, Goribu bypasses cache reads and writes so the build reads source data.
The resulting HTML and navigation props remain the build-time snapshot. A TTL
expiring or a cache entry being deleted does not refresh that static output;
rebuild and deploy to update it. See [static routes](static-routes.md).
