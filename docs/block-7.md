# Block 7 — KV (in progress)

## First substep — namespace declaration to binding

`kv: { name: "your-app-kv" }` declares one namespace in `goribu.config.js`.
Goribu synthesizes `KV`, lists its existing or missing production resource in
the read-only check plan, and creates or reuses it after a successful deploy
build. The production id is attached to the emitted binding before D1
migrations and Worker upload. Existing namespaces produce no change message.

The fixture initially exercised the raw binding through `req.env.KV`; the second
substep moves it to `req.kv`. Real site use, consistency guidance, and the
provisioning-layer assessment remain later substeps. This block is not complete
or deployed.

## Second substep — request-scoped KV

Every Worker request receives one lazy `req.kv` facade shared by middleware and
the handler. Accessing the facade does not read `env.KV`; its first operation
retains a valid binding or the missing-binding stub for that request. The stub's
operations reject with the expected binding, declaration, and restart/deploy
repair instructions. These failures pass through the ordinary error boundary.

The four methods preserve native values and promises:

- `get(key, { type?, cacheTtl?, metadata? })` defaults to text or null. Set
  `metadata: true` to return Cloudflare's value/metadata result; `type: "json"`
  parses stored JSON. Options use one object form.
- `put(key, value, { expiration?, expirationTtl?, metadata? })` forwards the
  value unchanged. JSON writes use explicit `JSON.stringify`; binary values and
  streams are not buffered or serialized by Goribu.
- `list({ prefix?, limit?, cursor? })` returns the platform page unchanged,
  including key metadata, expiration timestamps, and `list_complete`.
- `delete(key)` deletes one key.

The platform retains ownership of value/option validation and limits; the facade
rejects unknown options, non-object option arguments, and non-string/empty keys.
There is no bulk-read overload, additional metadata method, automatic pagination,
retry, read cache, or consistency emulation. Native operation failures propagate
unchanged. The platform contracts are described in Cloudflare's
[read](https://developers.cloudflare.com/kv/api/read-key-value-pairs/),
[write](https://developers.cloudflare.com/kv/api/write-key-value-pairs/), and
[list](https://developers.cloudflare.com/kv/api/list-keys/) references.

## Request-runtime review notes

- **Error identity is deliberately resource-specific for now.** KV's
  missing-binding stub throws plain `Error` with the framework prefix and repair
  instruction. D1 throws `GoribuD1Error` because `wrapDatabaseError` recognizes
  that class and preserves usage failures instead of reclassifying them as
  database failures. KV has no corresponding normalization layer or current
  consumer requiring a distinct class. Both reach the ordinary request error
  boundary. Substep 5's resource-layer assessment must explicitly decide whether
  a shared error identity has a concrete consumer; a difference in names alone
  does not justify a new class.
- **Malformed bindings are deliberately not memoized.** If `env.KV` exists but
  lacks native methods, validation throws before resolution is marked complete.
  Each later attempted operation reads and validates `env.KV` again. An unchanged
  malformed binding therefore fails each time before a storage operation runs.
  Valid bindings and missing-binding stubs remain stable within the request.
  This diagnostic-path asymmetry is accepted; no memoization change is owed.

## Lesson log

1. **There is no KV implementation to port from the previous source tree.** Its
   configuration validator has no KV declaration, its CLI is a stub, and it has
   no namespace provisioning or request wrapper. This substep is new code built
   around the existing pipeline; no source copy needed adaptation.
2. **The check plan already represents multiple resources; its inspector did
   not.** KV adds its own validated inventory and contributes resource, binding,
   and cost entries to the existing formatter. Pinned Wrangler's
   `kv namespace list` returns JSON and follows all inventory pages.
3. **Wrangler's namespace creation command also owns configuration editing and
   human output.** Goribu instead uses the official namespace creation API and
   the existing Wrangler credential resolver. It can validate the returned
   title/id and print just its own change without parsing prose or granting
   Wrangler a second configuration-writing path.
4. **Namespace creation and deploy are not a transaction.** A later binding,
   migration, or upload failure can leave the created resource in place. A
   retry discovers and reuses it by title; it never deletes a namespace to undo
   an unsuccessful deploy. Ambiguous inventories fail closed.
5. **The existing D1 credential resolver is reusable.** Its errors now say
   resource provisioning because KV calls it too. Resource-specific provisioning,
   ownership guards, and binding finalization remain explicit until the block's
   planned assessment, with both paths available to compare.
6. **The fixture shell selected an unsupported Node runtime.** Direct `node`
   initially selected Node 18 even though workspace tests used Node 22. Running
   the dev CLI with the installed Node 22 binary resolved it. The sandbox also
   required local listening-port permission for the Worker inspector. These
   were environment fixes, not framework changes.
7. **Metadata needs a read path without a second overlapping method.** The
   framework's `get` options include `metadata: true`, which selects native
   `getWithMetadata`. Plain reads still return values. This keeps the four
   operations in the plan and introduces no value encoding of its own.
8. **Pagination completion is independent of page length.** The wrapper returns
   `list_complete` and cursor unchanged, including an empty page with more to
   fetch. Tests cover that case as well as real two-page enumeration.
9. **An empty text response is still a body.** The first DELETE fixture returned
   `res.status(204).text("")`, which the existing response boundary correctly
   rejected. It now returns a normal text acknowledgement; the integration test
   then reads the key to prove deletion. No framework response change was needed.

## Validation so far

The suite passed with 76 files and 611 tests, including a production fixture
build and KV write/read through its emitted Worker. The local binding test reads
KV and writes that value to D1 in one Worker, using generated configuration with
no production ids. Focused tests cover malformed declarations, duplicate
Wrangler ownership, inspection failures, create/reuse behavior, binding
finalization, and aborting before migrations/upload on KV failure.

A subsequently added Vite guard test also passed, exercising duplicate KV
ownership rejection in both development and production setup.

The actual fixture `goribu dev` server also accepted a POST to `/kv` and returned
the stored value on GET through the generated local binding, with Node 22. The
value survived a full dev-server restart. The verification server was stopped
afterward; no production namespace was created or deployed during this substep.

After the request-runtime substep, `pnpm test` passed with **77 files and 618
tests**. The emitted fixture Worker proved ordinary and JSON/metadata reads,
native TTL expiration timestamps, two-page cursor enumeration, deletion, and
missing-value/metadata results. Focused request tests proved lazy resolution,
stable missing-binding errors, per-request isolation, middleware/handler sharing,
and propagation through the development error boundary. The first sandboxed
integration attempt could not open workerd's local listening port; rerunning
with local-port permission passed. No deployment was performed.
