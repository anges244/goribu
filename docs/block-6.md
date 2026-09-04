# Block 6 — Data, zero-config

This block gives an application persistent state without making it own a
Wrangler file. One database declaration now reaches all the way through a
read-only production plan, provisioning, generated local and production
bindings, request-scoped queries, real site data, and ordered schema history.

## What landed

- **One D1 declaration** — `database: { type: "d1", name, replication? }` in
  `goribu.config.js` is the application-owned input. Goribu synthesizes the one
  `DB` binding and rejects an author-owned `d1_databases` declaration rather
  than allowing two competing owners.
- **Read-only production planning** — `goribu check` lists the Worker target,
  existing and missing D1 resources, binding mapping, cost warning, and real
  production migration status. Missing resources and an absent ledger degrade
  legibly; authentication, malformed platform output, and malformed migration
  history fail closed.
- **Provisioning and deploy ordering** — `goribu deploy` validates and builds
  before remote work, creates or reuses the declared database, reconciles an
  explicit replication policy, finalizes the generated binding, verifies and
  applies production migrations, and only then uploads the Worker and assets.
  It prints resource changes rather than restating unchanged state.
- **A request-scoped D1 surface** — lazy `req.d1` tagged statements bind
  interpolated values and expose `get`, `all`, `value`, and `run`; explicit
  `unsafe` SQL is available when the application owns the fragments. Atomic
  batches, raw binding/session access, normalized `GoribuD1Error`s, and a
  fail-closed missing-binding stub share the same resolver.
- **Freshness and bookmarks** — public, fresh, and sequential request-scoped D1
  sessions implement the intended replica choices. The latest bookmark is
  committed immediately before response cookies flush, carrying read-your-writes
  through redirects. Live D1's invalid-bookmark failure retries once through an
  unconstrained session and no other operation error is retried.
- **Numbered schema history** — files named `0001_slug.sql` contain one up and
  one down marker. `migrate`, `migrate:new`, `migrate:status`, one-step
  `migrate:down`, and local-only `migrate:seed` use one tracking table and one
  drift planner. Forward SQL plus its ledger insert, or down SQL plus its ledger
  deletion, run in the same Wrangler batch.
- **The site as proof** — `/feedback` writes and reads real D1 rows. Its former
  per-request `CREATE TABLE IF NOT EXISTS` bootstrap is gone; an idempotent
  `0001_create-feedback` migration adopted the existing table without erasing
  production messages.
- **Docs** — `docs/d1.md`, `docs/migrations.md`, updated CLI/deploy guidance,
  matching public-site pages, the changelog, and this writeup describe the
  shipped contract and its failure boundaries.

## What emerged

- **The mapping overstated how much D1 could be copied.** Tagged query and
  session primitives existed in v2, but goribu3's request finalization, config,
  build, provisioning, generated binding, check, and migrations were new
  integration work. The runtime leaf behavior was adapted onto the v3 request
  boundary; the outside of the data layer was built here.
- **The live site was the necessary first consumer.** A synthetic counter would
  not have exercised a write, redirect, bookmark, and follow-up read together.
  Reusing feedback exposed the real production behavior, including the exact
  invalid-bookmark error returned by D1.
- **Runtime schema creation became visible debt as soon as migrations existed.**
  The temporary `ensureSchema()` made every feedback request perform DDL. The
  closing migration adopted the table idempotently, preserved existing rows,
  and removed schema ownership from request code.
- **Mandatory post-deploy migration was unsafe on a first release.** The initial
  Slice 2 decision kept Worker upload and migration as separate commands. The
  resulting window could publish code before its required tables existed. The
  final contract supersedes that behavior: deploy applies pending migrations
  before upload while continuing to state that Cloudflare offers no transaction
  across those systems.
- **The pinned Wrangler credential path needed a refresh between commands.** The
  live deploy succeeded, while the immediate read-only check received Cloudflare
  authentication error 10000. Refreshing the pinned Wrangler login restored the
  check; no deployed resource needed repair.

## Non-obvious choices

- **Bindings resolve lazily.** Constructing a request controller or statement
  does not touch `env.DB`; a terminal operation or explicit access resolves the
  binding once. This keeps binding failures inside the operation that needs it
  and prevents module-scope platform state.
- **There is one missing-binding path.** The resolver's D1-shaped stub throws the
  same teaching `GoribuD1Error` whether the caller used a tagged statement,
  batch, session, or raw binding access.
- **Replication omission and explicit policy differ.** A newly created database
  defaults to automatic read replication. On an existing database, omitting the
  field preserves its current policy; explicit true or false reconciles it.
- **Rollback is exactly one step and optional by truth, not syntax.** Every file
  has a down marker, but an empty section is an honest declaration that no safe
  inverse exists. `migrate:down` refuses rather than deleting the ledger row.
- **Seeds cannot reach production.** `migrate:seed --remote` is rejected at both
  the CLI and runner boundaries before configuration or SQL execution.
- **Deploy has no migration bypass.** `goribu migrate --remote` already lets an
  operator land a compatible expand migration early. A `--no-migrations` flag
  would add only the ability to upload code while known schema work remains.
- **Ordered does not mean atomic.** The old Worker serves while migrations and
  upload run, and migration files are separate D1 batches. Expand changes must
  work with the old Worker; destructive contract changes wait for a later
  release after old code has stopped relying on the shape.

## Verification — the "Done when"

The automated floor is green: 73 test files and 599 tests. Coverage includes
real local D1 through pinned Wrangler, transactional apply and rollback failure,
production-status planning, deploy ordering and abort boundaries, a production
site build, and workerd execution with the site's real migration applied.

The maintainer deployed the completed block on 2026-09-04 to
https://goribu-site.aggelos-gesoulis.workers.dev, version
`fadb24c5-2828-4912-9d7a-667f088ec355`. Live verification confirmed:

1. The deploy reused `goribu-site-db`, applied `0001_create-feedback` remotely,
   and only afterwards began the Wrangler Worker/assets upload.
2. The follow-up `goribu check` reported the existing database and `DB` binding,
   one defined and applied migration, no pending migrations, and no mutation.
3. `/feedback` returned `200` through the Worker after deployment and rendered
   the messages written before the migration, proving the data survived both the
   schema adoption and Worker replacement.
4. `/docs/d1`, `/docs/migrations`, and `/docs/deploy` returned `200` as new or
   updated Static Assets describing the deployed contract.

The Block 6 "Done when" is therefore true against the deployed site.

## Lesson log

1. **The v2 mapping described runtime pieces, not a usable data path.** Check,
   provisioning, binding synthesis, and migrations all had to be built around
   goribu3's real deploy pipeline. **New framework work.**
2. **D1 rejects an invalid bookmark during the first operation, not session
   construction.** The live error made a narrowly safe one-retry policy possible
   without risking duplicate writes. **Framework correction from live evidence.**
3. **Public route chunks exposed absolute build-machine paths in their emitted
   names.** The site deployment made the leak visible; generic content-addressed
   route names now retain mapping without disclosing source paths. **Framework
   hardening.**
4. **The site integration test depended invisibly on request-time schema DDL.**
   Removing `ensureSchema()` made the test fail on an empty local D1 until it
   explicitly applied the site's real migration. **Test correction that now
   proves the production contract.**
5. **Separate post-deploy migration created the wrong safety default.** The live
   plan review caught the schema-missing first-release window before closure.
   Deploy now migrates before upload; the decision history records both the
   original reasoning and its supersession. **Framework and documentation
   correction.**
6. **Wrangler authentication needed refresh at the final read-only proof.** The
   deployed app and D1 remained healthy; refreshing the pinned Wrangler OAuth
   session made the ledger visible again. **Operational lesson, no resource
   change.**

## Known residuals

- **No generalized resource provisioning layer yet.** D1 remains deliberately
  direct. Block 7 brings KV as the second real case and factors shared machinery
  only where both implementations prove the same shape.
- **D1 query-cost instrumentation remains dormant.** Capture/report hooks and a
  logging policy are not part of the shipped request API; they wait for a plan
  that names their consumer and behavior.
- **Cross-system atomicity does not exist.** Automatic ordering removes the
  schema-missing upload window, not the need for expand-and-contract migrations.
- **Public runtime types remain post-gate.** Runtime behavior is documented and
  tested in JavaScript; synchronized hand-written declarations arrive at the
  planned type gate.
