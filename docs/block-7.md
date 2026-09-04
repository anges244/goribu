# Block 7 — KV

Complete and live. One app declares both resources, the deploy provisions or
reuses both, and the community feed caches its persisted D1 feedback in KV. The
final deployment also exercised the pre-build authentication follow-up and
published its corrected guides. Production verification is recorded below;
there is no remaining implementation or live-verification work for this block.

## First substep — namespace declaration to binding

`kv: { name: "your-app-kv" }` declares one namespace in `goribu.config.js`.
Goribu synthesizes `KV`, lists its existing or missing production resource in
the read-only check plan, and creates or reuses it after a successful deploy
build. The production id is attached to the emitted binding before D1
migrations and Worker upload. Existing namespaces produce no change message.

The fixture initially exercised the raw binding through `req.env.KV`; the second
substep moved it to `req.kv`. The site now uses both stores and the shared
resource machinery has been assessed below.

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

## Third substep — eventual-consistency guidance

`docs/kv.md` and the site's `/docs/kv` page lead with the absence of an immediate
read-after-write or read-after-delete guarantee. They cover cached misses,
propagation delays without a fixed deadline, cache TTL versus key expiration,
stale listings, lost concurrent updates, and confirmations that do not depend on
rereading KV. The guide points to D1 for correctness-sensitive state and states
that local integration tests do not prove global propagation timing.

The site navigation and guided-tour links include the new page. This substep
documents the consistency boundary explicitly requested before real site KV use;
the closing documentation now includes the complete usage guide and its real
site consumer. The page is now deployed and was verified with HTTP 200.

## Fourth substep — a real site cache

`/community` shows recent public feedback from a saved KV snapshot. A cache miss
reads the latest ten D1 messages through `req.d1.public` and stores a versioned
JSON snapshot with a 300-second expiration. A hit needs no D1 query and does not
extend the snapshot's lifetime. The page shows when the snapshot was generated
and explains delayed updates. HTTP responses use `no-store`, so there is no
second response cache obscuring the KV behavior.

The existing submission page continues using D1 directly with its bookmark.
The shared snapshot contains no visitor state or bookmark. Concurrent cache
fills can overwrite each other safely because either result is a complete,
disposable public snapshot. Failed fills are logged and the successful D1 read
still renders; failed KV reads propagate through the error boundary. No cache
invalidation promise, lock, or fake consistency layer was added.

## Fifth substep — resource-layer assessment

KV exposed two concrete D1-shaped ownership boundaries worth factoring:

- `cloudflare-access.js` now owns the existing Wrangler credential/account
  resolver used by both provisioners. KV no longer imports D1 provisioning just
  to authenticate. The credential behavior is unchanged.
- `update-deploy-config.js` owns locating, reading, and updating the emitted
  Wrangler configuration. Both finalizers supply their resource-specific
  validation and id update. The common boundary checks resolved filesystem paths
  as well as lexical containment, preventing a symlink from redirecting writes
  outside the application.

The check formatter already accepted multiple resource entries and needed no
new abstraction. D1 replication reconciliation and migration ordering differ
from KV's create-or-reuse behavior, so the provisioners and declaration guards
remain explicit. There is no resource-adapter registry or general CRUD layer.

The error-identity review is resolved: keep D1's normalization-specific error
class and KV's plain errors. The real site cache needs no shared error identity;
it handles failed cache fills as optional work and lets read failures propagate.
The accepted malformed-binding revalidation behavior remains unchanged.

## Deployment follow-up — authenticate before building

The maintainer's first deploy attempt completed its build and then failed
because Wrangler was not logged in. Deploy now validates local config and
binding ownership, resolves Wrangler credentials and an unambiguous account,
then builds. This preflight also runs without resource declarations. D1 and KV
reuse the access result within the invocation; no Goribu credential store was
added. Resource creation and mutations still wait for a successful build.

Missing authentication fails with login/token repair instructions rather than
launching an interactive browser. The guides' earlier automatic-login promise
was incorrect for the resource path and has been replaced with explicit setup.
Standalone builds remain authentication-free. Authentication is not a promise
that every later permission check or network request will succeed.

## Request-runtime review notes

- **Error identity is deliberately resource-specific for now.** KV's
  missing-binding stub throws plain `Error` with the framework prefix and repair
  instruction. D1 throws `GoribuD1Error` because `wrapDatabaseError` recognizes
  that class and preserves usage failures instead of reclassifying them as
  database failures. KV has no corresponding normalization layer or current
  consumer requiring a distinct class. Both reach the ordinary request error
  boundary. Substep 5 confirmed that the real consumer needs no shared error
  identity; a difference in names alone does not justify a new class.
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
10. **Immediate local visibility is not the production contract.** Cloudflare's
    consistency reference explicitly declines to guarantee even same-location
    visibility and describes delays of 60 seconds or more elsewhere. The guide
    uses that contract rather than promising a fixed propagation deadline or
    promoting a passing local round trip into a consistency guarantee.
11. **The linked D1 site guide retained superseded deployment advice.** Its last
    paragraph still said deploy never applies migrations, contradicting the
    settled Block 6 decision and the migration guide. It now states the existing
    provision/migrate/upload ordering. This was a prose correction only.
12. **A cache fill is optional work after a successful database read.** Two
    locations can miss and write the same key concurrently; a rejected fill must
    not turn useful feedback into an error page. The site logs the failure and
    serves the D1 snapshot. Hits do not query D1 or extend cache lifetime.
13. **The duplicated artifact boundary checked only lexical paths.** Factoring
    the two finalizers made the symlink escape visible. Both now verify the real
    destination remains inside the application, with one regression test proving
    neither resource can modify an external target through a symlink.
14. **Build-before-mutation need not mean build-before-authentication.** The
    logged-out deploy exposed wasted work. A credential/account preflight catches
    that prerequisite early without creating resources, and using the result in
    both provisioners avoids repeating credential resolution.

## Deliberate limits

- One D1 database and one KV namespace; no multi-namespace registry.
- KV has no atomic update, transaction, read-your-writes overlay, automatic
  retry, or automatic cursor loop. Local tests cannot prove global propagation.
- Resource creation, D1 migrations, and Worker upload are ordered but not one
  transaction. Failure never triggers automatic resource deletion.
- Runtime type declarations remain post-gate. No new error class or generic
  runtime binding abstraction was needed for the two current resources.

## Validation

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

For the consistency-documentation substep, the site production integration check
passed all **4 tests**, including compilation and static output of `/docs/kv`
with managed metadata and client assets. The linked D1 migration wording was
corrected and the check rerun successfully. `git diff --check` passed. Framework
runtime code was unchanged, so the broader suite was not rerun for this prose
and documentation-route change. Live publication remains maintainer-owned.

After the site consumer, resource assessment, and closing documentation,
`pnpm test` passed with **79 files and 622 tests**. The production site Worker
test proves a cache miss fills KV from D1, a hit retains that snapshot after a
new D1 entry, and deleting the local cache permits a refreshed snapshot. Focused
tests cover failed cache fills and the shared deploy-artifact safety boundary.
`git diff --check` passed.

The read-only production command `pnpm --dir site exec goribu check` found the
existing `goribu-site-db` database with `0001_create-feedback` applied and no
pending migrations. It reported `goribu-site-kv` missing and planned its creation
and `KV` binding on deploy. The check made no changes.

## Production verification

The maintainer deployed version `0fa687b5-1232-470c-ba48-07d5317c27d4` at
https://goribu-site.aggelos-gesoulis.workers.dev. The deploy created
`goribu-site-kv` (`30fa62f86cf94a21b968315d533d157c`), reused the existing D1
database, found its single migration already applied, and uploaded the Worker
with both `KV` and `DB` bindings.

Follow-up verification on 2026-09-05 (maintainer local date) found:

- `/community` returned HTTP 200 and `Cache-Control: no-store`, with the three
  existing D1 feedback messages and the delayed-update explanation.
- Repeated requests returned the same generated snapshot. A read-only production
  KV API request returned exactly the same JSON as the page's serialized props,
  proving that the public page is using a real stored snapshot.
- `/docs/kv` and `/docs/deploy` returned HTTP 200; the KV guide included its
  eventual-consistency warning.
- `pnpm --dir site exec goribu check` found both resources, none missing or to
  create, and one applied migration with none pending. No resources were changed.

The real credential/account resolver also succeeded after the preflight change;
one observed run took 4.79 seconds. This is a measurement of that invocation,
not a latency guarantee. The final maintainer deploy exercised its new position
before the build and published the corrected authentication guides.

After that follow-up implementation, `pnpm test` passed with **79 files and 625
tests**. Focused deploy/provisioning checks passed **32 tests in 4 files**,
covering preflight ordering, stopping before builds and mutations on failure,
resource-free deployments, shared access results, supported credential types,
and rejected account/credential states. `git diff --check` passed. No deployment
was performed by the agent.

### Final closeout

The maintainer's final deployment, version
`fd949645-2670-4d93-8d7f-7bcc05c69330`, succeeded with the existing KV namespace
and D1 database, no resource-creation messages, and the migration already applied.
The authentication preflight is silent on success, so Vite remains the first
visible output; the tested deploy ordering runs authentication before it.

Post-deploy checks on 2026-09-05 confirmed HTTP 200 for `/community`, `/docs/kv`,
`/docs/deploy`, and `/docs/cli`. The community page still showed all three
persisted messages with `no-store` and its delayed-update explanation. The
published deploy and CLI guides now state pre-build authentication and
authentication-free standalone builds; the deploy guide includes explicit
bundled-Wrangler login instructions. The KV consistency warning remains live.
The read-only production plan again found both resources, none missing or to
create, and one applied migration with none pending.

Only closeout documentation changed after the passing 625-test suite;
`git diff --check` passed. Block 7 is complete, with no unresolved residuals
beyond the deliberate limits above. Block 8 has not started.
