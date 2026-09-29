# Handlers

A route can do more than render a page. Export a function named for an HTTP
method — `GET`, `POST`, `PUT`, `PATCH`, `DELETE` — and Goribu calls it for that
method instead of rendering. A handler receives the request and a response
builder, and returns an intent describing the response.

Handler export names must be uppercase: `GET`, `POST`, `PUT`, `PATCH`,
`DELETE`, `HEAD`, and `OPTIONS`. Development and production builds reject
runtime exports such as `post` or `Post` with the route filename and the correct
spelling. These names are reserved even when the exported value has another use;
rename it or keep it local to the module.

The exported name matters: `function post() {}` with `export { post as POST }`
is valid. Named re-exports and destructured variable exports follow the same
rule. Explicit type-only exports and ambient declarations do not define handlers.
Namespaces containing only interfaces and type aliases are ignored too, including
nested namespaces and local export aliases. Namespaces with runtime values remain
subject to the casing rule.

```js
// src/routes/hello.js
export function GET(req, res) {
  return res.json({ greeting: `Hello, ${req.query.get("name") ?? "world"}` });
}
```

`GET /hello?name=Ada` answers `{"greeting":"Hello, Ada"}`. A handler file needs
no default export; a file may export **both** a default page and handlers, in
which case an explicit handler answers its method and the page answers the rest.

## The handler contract

A handler is `(req, res) => intent`. It must **return a `res.*` result** — never a
raw `Response`, never a bare value. Returning nothing, a `Response`, or a plain
object is a mistake Goribu catches with a message telling you what to do instead.
Handlers may be `async`.

```js
export async function POST(req, res) {
  const body = await req.body();
  return res.json({ received: body });
}
```

## The request — `req`

| Property | What it is |
|---|---|
| `req.method` | the HTTP method string |
| `req.path` | the URL pathname |
| `req.params` | captured dynamic segments, e.g. `{ id: "42" }` for `posts/[id].jsx` |
| `req.query` | a `URLSearchParams` — `req.query.get("name")`, `req.query.getAll(...)` |
| `req.headers` | the request `Headers` |
| `req.cookies` | the cookie jar — see [Cookies](#cookies) |
| `req.r2` | native R2 operations and public URLs — see [R2](r2.md) (in progress) |
| `req.env` | the Worker bindings object (see [Bindings](#bindings-and-background-work)) |
| `req.waitUntil(promise)` | keep the Worker alive for background work |
| `req.rawBody()` | the raw body bytes as a `Uint8Array` |
| `req.body()` | the parsed body, by content type — see [Reading the body](#reading-the-body) |

`req.params` values are always strings, and the object is safe against prototype
keys — a param literally named `__proto__` is an own property, not a mutation of
`Object.prototype`.

## Reading the body

`req.body()` parses the request body according to its `Content-Type`, with one
read shared behind the scenes so it can't be consumed twice:

- `application/json` → the parsed **object** (a non-object JSON body, like a bare
  array, is a `400`).
- `application/x-www-form-urlencoded` → a plain **object** of fields; repeated
  fields become arrays. Field names can't pollute the prototype.
- `multipart/form-data` → a plain **object** of fields, with uploads as `File`
  values; repeated names become arrays, including repeated files or mixed values.
- `text/*` → the decoded **string**.
- anything else, or an empty body → an empty object `{}` (a friendly default, not
  an error).

Both form encodings use the same field shape: one value stays a string or
`File`, repeated values become an array in submission order, and missing fields
are absent. Empty strings remain empty strings. Goribu does not coerce numbers
or booleans, or interpret names such as `user[name]` as nested objects. Validate
field types and file size/content before using them.

**Migrating multipart handlers:** `req.body()` no longer returns `FormData`.
Replace `body.get("name")` with `body.name`; a missing field is now `undefined`
rather than `null`. Where you used `body.getAll("tag")`, handle an absent field,
a single value, or an array. Remove `instanceof FormData` branches. JSON and text
parsing are unchanged; `rawBody()` still provides the original bytes.

A malformed body of a *supported* type — broken JSON, a multipart body with no
boundary — is a client mistake, so `req.body()` rejects with a **`400`** carrying
a safe message rather than crashing the request. See [errors.md](./errors.md).

`req.rawBody()` gives you the exact bytes when you need to parse something Goribu
doesn't, or verify a signature. Calling `body()` and `rawBody()` in any order
reads the underlying stream only once.

```js
export async function POST(req, res) {
  const raw = await req.rawBody();        // Uint8Array — the exact bytes
  // ...verify a webhook signature over `raw`, then:
  const data = await req.body();          // still works; the read is cached
  return res.json({ ok: true, size: raw.byteLength });
}
```

## The response builder — `res`

Terminal helpers return an intent; Goribu turns it into the actual response,
applying framework behavior (cookies, the document shell, the error boundary)
along the way.

| Call | Response |
|---|---|
| `res.text(body)` | `text/plain` |
| `res.json(data)` | `application/json` |
| `res.redirect(location)` | a redirect — **`303`** by default |
| `res.render(props)` | the route's own page, streamed as HTML, with `props` |
| `res.notFound(props)` | the app's `_404` page at `404` |

Chain `res.status(code)` and `res.headers({ ... })` before a terminal helper to
set the status or add headers:

```js
export function POST(req, res) {
  return res.status(201).headers({ "x-created": "yes" }).json({ id: 7 });
}
```

- **`res.redirect`** defaults to `303 See Other` — the right status after a POST,
  so a browser re-requests the target with `GET`. For another redirect status,
  set it explicitly: `res.status(301).redirect("/new-home")`.
- **`res.render(props)`** works only on a route that has a default page export;
  it streams that page through the document shell with the props you pass, so a
  handler-rendered page is identical to an implicit GET of the page apart from the
  data (and any status/headers) it carries. There is no `res.html(string)` — HTML
  from a handler is a rendered page. (See the decision in
  [decisions.md](./decisions.md).)
- Bodyless statuses (`204`, `205`, `304`) reject a body — Goribu tells you rather
  than shipping an invalid response.

## Cookies

`req.cookies` reads incoming cookies and queues outgoing ones; Goribu appends the
`Set-Cookie` headers to the final response.

```js
export function POST(req, res) {
  const seen = Number(req.cookies.get("visits") ?? "0");
  req.cookies.set("visits", String(seen + 1), { httpOnly: true, sameSite: "Lax" });
  return res.redirect("/");
}
```

- `req.cookies.get(name)` → the incoming value, or `null`.
- `req.cookies.set(name, value, options?)` — `options` may include `domain`,
  `path`, `expires`, `maxAge`, `httpOnly`, `secure`, `sameSite`.
- `req.cookies.delete(name, { path?, domain? })`.

Goribu adds no security defaults — `sameSite: "none"` does not imply `secure`;
set what your cookie needs. Cookie values must be plain ASCII tokens; encode
structured or Unicode data before setting.

## Bindings and background work

Goribu calls your Worker as `fetch(request, env, ctx)` and hands routes the parts
they should touch — never the raw execution context:

- **`req.env`** is the Worker bindings object exactly as Cloudflare passes it
  (KV, D1, R2, queues, `vars`, and the built-in `ASSETS` binding). Request-scoped
  data bindings get their own ergonomics in a later block; here `req.env` is the
  raw pass-through.
- **`req.waitUntil(promise)`** extends the Worker's lifetime past the response so
  background work finishes — logging, cache writes, analytics. It's the bound
  `ctx.waitUntil`; `ctx` itself stays private.

```js
export function GET(req, res) {
  req.waitUntil(recordHit(req.env.ANALYTICS, req.path));  // runs after the response
  return res.json({ ok: true });
}
```

## Server-only modules (`.server.*`)

Code that must never reach the browser — secrets, database drivers, admin SDKs —
goes in a file named `*.server.js` (`.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, and
their variants). A handler may import it freely; the client build **fails closed**
if a `.server.*` module ever reaches browser code, and it's tree-shaken out of the
client bundle when only handlers use it.

```js
// src/lib/secret.server.js
export const API_TOKEN = "…";        // never shipped to the browser
```

```js
// src/routes/report.js
import { API_TOKEN } from "../lib/secret.server.js";
export function GET(req, res) { /* use API_TOKEN server-side */ }
```

For now, keep `.server.*` modules **outside** `src/routes/` (import them from a
`src/lib/` or similar) — a `.server.*` file placed under `src/routes/` is treated
as a route and fails route analysis. Colocating server modules beside their routes
is a future routing decision, recorded in [decisions.md](./decisions.md).

## What a handler route answers on its own

Given handlers, Goribu still fills in the mechanical methods:

- **HEAD** runs the `GET` handler (or renders the page) and drops the body.
- **OPTIONS** → `204` with an `Allow` header listing the route's methods.
- An unsupported method → `405` with an `Allow` header.

## See also

- [middleware.md](./middleware.md) — code that runs before a route's handler or
  page, per folder.
- [errors.md](./errors.md) — what happens when a handler throws, and the `400`
  from a malformed body.
- [routing.md](./routing.md) — how files become URLs, and dynamic segments.
