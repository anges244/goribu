---
title: KV
description: Understand eventual consistency before using Workers KV for application state.
---

> **KV is eventually consistent. A successful `await req.kv.put(...)` or
> `delete(...)` does not guarantee that the next read sees the change.**
> Choose KV only when temporarily stale or missing data is acceptable.

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

