---
title: KV
description: Understand eventual consistency before using Workers KV for application state.
---

> **KV is eventually consistent. A successful `await req.kv.put(...)` or
> `delete(...)` does not guarantee that the next read sees the change.**
> Choose KV only when temporarily stale or missing data is acceptable.

## Declare a namespace

Add one KV namespace to `goribu.config.js`:

```js
import { defineConfig } from "goribu/server";

export default defineConfig({
  name: "my-app",
  compatibilityDate: "2026-09-04",
  kv: { name: "my-app-kv" },
});
```

Goribu generates `KV` for local development and production. Names start with a
lowercase letter or digit, contain only lowercase letters, digits, hyphens, or
underscores, and are at most 63 characters. Use `goribu check` to inspect the
production plan, then `goribu deploy` to create or reuse the namespace. Do not
also declare `kv_namespaces` in a Wrangler file. See [Deploying](/docs/deploy).

## Read and write from a handler

This complete `src/routes/notice.js` module stores a temporary public notice.
POST accepts a JSON object; its acknowledgement returns the submitted data
without depending on an immediate KV reread.

```js
export async function GET(req, res) {
  const notice = await req.kv.get("notice", { type: "json", metadata: true });
  return res.json(notice);
}

export async function POST(req, res) {
  if (!req.headers.get("content-type")?.startsWith("application/json")) {
    return res.status(415).json({ error: "Send an application/json object." });
  }
  const notice = await req.body();
  await req.kv.put("notice", JSON.stringify(notice), {
    expirationTtl: 300,
    metadata: { updatedAt: new Date().toISOString() },
  });
  return res.json({ saved: notice });
}

export async function DELETE(req, res) {
  await req.kv.delete("notice");
  return res.json({ deleted: true });
}
```

There is no automatic JSON encoding: explicitly stringify structured values
before writing. Native text, binary values, and streams pass through unchanged.
Await writes/deletes before reporting success.

## The four operations

| Method | Options and result |
|---|---|
| `get(key, options?)` | Text or `null` by default. `type` selects `text`, `json`, `arrayBuffer`, or `stream`; `cacheTtl` controls read caching. `metadata: true` returns the native value/metadata result instead. |
| `put(key, value, options?)` | Resolves when the write succeeds. Options: `expiration` (epoch seconds), `expirationTtl` (seconds from now), and JSON-serializable `metadata`. |
| `list(options?)` | Returns `keys`, `list_complete`, and a continuation cursor when needed. Options: `prefix`, `limit`, and `cursor`. Key entries may contain `expiration` and `metadata`. |
| `delete(key)` | Resolves when the delete succeeds; later readers can still see cached data. |

Pass one non-empty string key to get/put/delete and use an object for options,
including read types: `{ type: "json" }`. The shorthand `get(key, "json")`,
bulk-read arrays, and unknown options are rejected. There is no separate
`getWithMetadata` method on `req.kv`. A missing key returns `null`, or a
result with `value: null` and `metadata: null` when metadata was requested.

For pagination, keep the original prefix and limit when supplying the next
cursor, and stop only when `list_complete` is true. Goribu neither loops over
pages nor retries operations for you. Cloudflare validates native values and
limits; in particular, key expiration must be at least 60 seconds in the future.
See the [write limits](https://developers.cloudflare.com/kv/api/write-key-value-pairs/)
and [list reference](https://developers.cloudflare.com/kv/api/list-keys/).

## A real use on this site

[Community feedback](/community) caches the ten latest public D1 messages
under a versioned key with a five-minute expiration. Cache hits avoid a database
query; misses read D1 and attempt to store a complete snapshot. A competing or
failed cache fill is logged while the successful database result is still shown.
The page displays its snapshot time and allows delayed updates. The feedback
submission page continues reading D1 directly with its bookmark, so the
confirmation flow does not depend on KV propagation.

## Missing bindings and failures

`req.kv` is shared by the middleware and handler within one Worker request.
Its first operation resolves `env.KV`; unused KV causes no binding access.
An absent binding rejects with a `[Goribu]` error identifying the declaration
and repair: add `kv: { name }`, then restart development or deploy again.
Malformed bindings also fail before storage work. Native operation errors
propagate to the ordinary request error boundary unless the application handles
them. Access to the native binding remains available through `req.env.KV`.

## What a successful write means

A visitor updates a display preference, the POST succeeds, and the browser
redirects to a GET. That GET can still return the old value or `null`. A delete
can likewise leave a previously cached value visible for a while.

Cloudflare documents propagation delays of 60 seconds or more; this is not an
upper bound. Even reads in the location that accepted the write have no
immediate-visibility guarantee. A cached missing-key result can also hide a new
key. See [Cloudflare's consistency contract](https://developers.cloudflare.com/kv/concepts/how-kv-works/#consistency).

Goribu's request-scoped binding does not strengthen this contract. `req.kv` has
no session bookmark, read-your-writes overlay, or `fresh` mode. Reading through
`req.env.KV` has the same platform semantics.

## Show confirmation without assuming a fresh read

Await the write before reporting success. Confirm the submitted value from the
write response or retained form state, and explain that other views may take
time to update. A redirect, reload, or repeated polling does not establish that
every reader now sees the write. Do not repeat a successful write merely because
a read still looks stale.

For correctness-sensitive state, use [D1](/docs/d1) with its session and
database-update semantics. Goribu's D1 bookmark handles the write-then-redirect
flow; it does not make a separate KV read fresh.

## Cache lifetime is not data lifetime

`get(key, { cacheTtl })` controls Cloudflare's read cache, including cached
misses. Increasing it can extend staleness. `cacheTtl: 0` is not a supported
fresh-read escape hatch. Reading metadata does not bypass this cache.
[Cloudflare read caching](https://developers.cloudflare.com/kv/api/read-key-value-pairs/#cachettl-parameter).

`put(key, value, { expirationTtl })` schedules the stored key's expiry.
It does not flush other locations' caches or create a consistency guarantee.
[Cloudflare expiration options](https://developers.cloudflare.com/kv/api/write-key-value-pairs/#expiring-keys).

## Lists and concurrent changes

`list()` can lag too. Treat a cursor as pagination state, not as proof that a
write or delete is globally visible. Continue until `list_complete` is true,
even if an intermediate page has no keys.
[Cloudflare list behavior](https://developers.cloudflare.com/kv/api/list-keys/).

A read followed by a write is not an atomic update. Two requests can both read
a counter of 10 and each write 11. Concurrent writes can overwrite one another;
KV provides no transaction around this sequence.
[Cloudflare concurrent-write guidance](https://developers.cloudflare.com/kv/api/write-key-value-pairs/#concurrent-writes-to-the-same-key).

Use KV for data such as cached public summaries or display preferences whose
temporary staleness the application can tolerate. Do not use it as the authority
for balances, uniqueness checks, exact counters, or access revocation that must
take effect immediately.

Local development and the fixture's write/read tests prove API wiring. They do
not simulate or prove global propagation timing.

**Next:** [Metadata & Document](/docs/metadata).
