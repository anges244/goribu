# Block 7 — KV (in progress)

## First substep — namespace declaration to binding

`kv: { name: "your-app-kv" }` declares one namespace in `goribu.config.js`.
Goribu synthesizes `KV`, lists its existing or missing production resource in
the read-only check plan, and creates or reuses it after a successful deploy
build. The production id is attached to the emitted binding before D1
migrations and Worker upload. Existing namespaces produce no change message.

The fixture declares a namespace and exercises the raw binding through
`req.env.KV`. The `req.kv` wrapper, real site use, consistency guidance, and
provisioning-layer assessment remain later substeps. This block is not complete
or deployed.

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
