# Cache

`req.cache` stores JSON values in Cloudflare's Cache API to avoid repeating
expensive reads or computation. It needs no binding or configuration and is
available in handlers and middleware. Production caching requires a deployment
where Cloudflare supports the Cache API; see [Keys and scope](#keys-and-scope).

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

Deployment support needs both platform documentation and actual cache hits:

| Deployment | Cache API behavior |
|---|---|
| Worker on a custom domain or route | Cloudflare documents support; Goribu's custom-domain fixture passed live checks. |
| `*.workers.dev` | Goribu's named cache passed live checks on the fixture deployment, despite the no-op restriction in Cloudflare's R2 guide. This is not a guarantee for every deployment. |
| Workers dashboard editor and Playground previews | Cloudflare documents that cache operations have no impact; not tested in this checkpoint. |
| Worker fronted by Cloudflare Access | Cloudflare documents the Cache API as unavailable; not tested in this checkpoint. |

The `workers.dev` restriction is explicit in Cloudflare's
[R2 Cache API guide](https://developers.cloudflare.com/r2/examples/cache-api/),
but our live results below establish working `req.cache` operations on the
tested `workers.dev` origin. We have not established the reason for this
discrepancy and do not disable the helper based on that hostname.
The [runtime reference](https://developers.cloudflare.com/workers/runtime-apis/cache/)
also documents the editor, Playground, and Access restrictions. These concern
the Cache API used by `req.cache`; Cloudflare's separate Workers Cache product
does not establish support for this API.

An unsupported deployment may accept writes without retaining entries and
return misses without throwing. Goribu's exception warnings cannot detect that
case: a successful `set` or absence of warnings does not establish a cache hit.
Verify actual hits on the deployment where caching matters. Local workerd tests
alone do not prove production host support.

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
or TTL expiry. Configure it through Cloudflare's
[Worker placement settings](https://developers.cloudflare.com/workers/configuration/placement/).

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

## Contributor live checkpoint — verified 2026-10-02

After maintainer deployment, the fixture's `/cache` endpoint passed one batch
on both supplied origins:

- https://goribu-basic-app.aggelos-gesoulis.workers.dev
- https://goribu-basic-app.anges244.com

The run took place at 2026-10-01 22:07:37–45 UTC (October 2 in Athens), using
run ID `1790892457667-71c2ba93-ba19-45b8-9b65-c2e8286e133d`. All 28 requests
returned HTTP 200, with these observed results:

| Check | workers.dev | Custom domain |
|---|---|---|
| Unique key before writing | Miss | Miss |
| Distinct `/safe/../item?#` and `/item?#` suffixes, both written before reading | Each returned its own value | Each returned its own value |
| Delete one entry | Deleted entry missed; other entry still hit | Deleted entry missed; other entry still hit |
| Five-second TTL | Immediate hit; miss after a six-second wait | Immediate hit; miss after a six-second wait |
| Same key with different origin values | Kept its own value | Kept its own value |

A fresh key written only on the custom origin also missed on `workers.dev`
before its own write, confirming that the independent values were origin-scoped.
The batch used only unique test keys with five- or 60-second TTLs and did not
change application data or account configuration.

Each HTTP request had a fresh transport query nonce and requested no HTTP-cache
reuse. Responses had no `Age` or `CF-Cache-Status` header. Every `CF-Ray` ended
in `ATH`; example literal-key hits were `a43ec808cd9dbe00-ATH` on `workers.dev`
and `a43ec8092aa25ef7-ATH` on the custom domain. Rays identify ingress, not
execution placement. The deployed version and placement settings were not
queried, and this batch makes no global consistency or Smart Placement claim.
Dashboard previews, Access, and other deployments remain untested.

This closes the planned two-origin live checkpoint for the observed behavior.
The earlier local run passed 90 runtime tests plus the two tests in
`public-types.test.js` (92 total), and one separate emitted-Worker integration
test. Those suites were not rerun for this live verification or its doc updates.
