# R2 live checkpoint

This is the release gate for managed R2. **The live checkpoint is closed as of
2026-10-01, with five explicitly accepted untested account scenarios below.**
Package release preparation and publication are still pending.
Local tests, signature vectors, and workerd do not establish live R2 enforcement,
Cloudflare API response shapes, or browser behavior. Use this document with the
[R2 guide](r2.md); it does not depend on private planning files.

## Progress on 2026-09-30

The default-jurisdiction app at
<https://goribu-r2test.aggelos-gesoulis.workers.dev/r2> runs the framework from
42d05c1, deployed with Wrangler 4.144.0. The maintainer verified in Chrome 154:
public image and private PDF uploads, submit during a transfer, replacement
selection, native reset followed by an empty submission, rejected file types,
URL-encoded forms, inline PDF viewing, and Unicode download filenames.
These observations do not establish every cancellation or preview-cleanup case.

Observed HTTP checks passed for public immutable cache headers, private GET/HEAD,
206/416 ranges, 304 ETag revalidation, malformed-token refusal with fixed security
headers, the production dev-file endpoint's 404, and unauthenticated start/form
requests. Missing/duplicate refs and tokens are rejected, and unsupported methods
return 405. The maintainer confirmed an existing PDF link and public object still
worked after redeploy. Exact timed expiry tests were still pending at this initial checkpoint; subsequent results are below.

Read-only account checks confirmed bucket/Worker missing codes 10006/10007,
default-jurisdiction bucket/domain reads, both managed bindings, enabled public
domain, no private-bucket public access, and the existing workers.dev origin.
The selected zone is anges244.com, so the separate subdomain-zone case remains
pending. Rename/removal diagnostics were exercised in memory against live
metadata; the later temporary-config checks are recorded below.

Both existing buckets returned HTTP 404/code 10059 for absent CORS settings.
The framework now recognizes only that specific missing-policy response as an
empty rule list, with regression coverage and successful repeated live reads.
The change was subsequently installed and deployed: read-back confirmed the
managed rule on both buckets, and a public-bucket OPTIONS request returned 204
allowing the exact app origin, PUT and all four headers. The maintainer's first
browser direct-upload control failed: start returned 200, preflight 204, and
the R2 PUT returned 400. A maintainer-run curl diagnostic reproduced 400 with
InvalidArgument; its sanitized error classification mentioned credential,
access key and length, and the binding inspector confirmed no object existed.
After correcting the credential pair, the maintainer's curl control returned
200 and created the object. The browser control then passed with all four CORS
headers, binding upload ID, size/type, digest, immutable cache policy and ref
verification. The Worker-side diagnostic probe separately returned 500: local
reproduction found that Workers fetch rejects redirect mode "error". The test
helper now uses "manual" and explicitly refuses redirect responses; its local
Worker reproduction and redirect-rejection checks passed. The maintainer then
deployed the correction and completed the direct checks recorded below. Grouped
checkboxes stay unchecked until all their cases have evidence. No release gate
is waived.

## Worker transport follow-up on 2026-10-01

The maintainer ran the grouped authenticated diagnostic against the same deployed
app: all 13 checks passed. It confirmed start type/size/field rejection (including
the size limit), a successful control PUT with exact Worker read-back, replay
409 with preserved bytes, shorter/longer/type-mismatched PUT rejection, absent
fields after skipped PUTs, forged/wrong-field/array/object ref refusal, and a
concurrent PUT race with exactly one winner whose bytes match the stored object.
Failed If-Match returned 412 with fixed security headers. A real 60-second PUT
expiry returned 403 and left the form field absent.

These checks cover the Worker binding's conditional put. They do not establish
S3 signed-header enforcement, deterministic-key ownership after a new start,
direct-upload metadata, one-hour ref expiry, or large-body streaming. Subsequent
results are recorded below; the broader checklist remains the release gate.

## Additional browser checks on 2026-10-01

The maintainer ran the static `/r2-checks` page against the protected Worker
actions. All eight grouped checks passed: upload() with JSON submission and
binding metadata/digest inspection; deterministic-key skipped PUT and actual
409 cases with matching and different sizes preserving the original identity;
route and same-bucket field binding; protected missing-object 404; actual signed
download expiry after a successful control GET; cross-route size errors with the
receiving policy limit; encoded spaces/Unicode in a working public image URL;
and controlled HTML/SVG with fixed security headers and no script execution.
Both browser frames visibly reported that their scripts did not run.

The two-field form on that static page also passed: Save waited for both PDFs,
both verified filenames appeared, automatic reset cleared the pickers, and a
second submission had neither ref. The maintainer subsequently reported that
the real one-hour ref-expiry check passed and the stored bytes were preserved.
Direct S3 results follow below; the remaining account and browser scenarios
still require evidence or an explicitly reviewed resolution.

## Direct enforcement checks on 2026-10-01

The maintainer reported all 12 grouped checks passing on `/r2-direct-checks`
with default-jurisdiction buckets and the CORS-fixed package based on 42d05c1.
A real browser PUT succeeded with all four headers; the binding inspector
confirmed upload ID, size/type, digest, immutable cache policy and accepted ref.
A separate successful HTTP-probe control established that later refusals were
R2 responses rather than browser CORS failures.

Shorter/longer bodies, changed content type, omitted/changed If-None-Match, and
omitted/changed upload ID each returned 403 SignatureDoesNotMatch with no object
created; the matching control then succeeded for each target. Replay returned
412 and preserved the digest. Concurrent S3 PUTs produced one 200 and one 412,
and the stored digest matched the winner. An opaque browser origin was denied
without a write; the same target succeeded from the app origin. These establish
S1, S2 and upload identity for this tested account and jurisdiction. Large-file
and presigned PDF results follow below; unperformed deployment/account cases
remain pending.

## Large transfers on 2026-10-01

The maintainer reported both generated-file tests passing: 20,000,000 bytes
through the Worker policy and 110,000,000 bytes through the direct policy. Each
stored object's binding-stream SHA-256 matched the generated file, and the
verified form ref reported the expected size. Inspection of the test app's built
Worker confirmed production mode and the upload endpoint passing request.body
to the conditional R2 put; arrayBuffer() is confined to the development branch.
This establishes the representative S4 streaming case and an above-100-MB direct
transfer on this account, without claiming a memory benchmark or the maximum
supported file size. Presigned PDF results follow below.

## Presigned PDF checks on 2026-10-01

After the direct and large-file checks, the maintainer confirmed the private PDF
flow and all three links worked: inline viewing, an ASCII attachment named
checkpoint.pdf, and a Unicode attachment named Checkpoint — café.pdf. The test
page checks successful presigned GETs, application/pdf and the ASCII/UTF-8
Content-Disposition overrides before showing those links. This establishes S5
for the tested default-jurisdiction bucket. EU signing/delivery remains untested.

## Read-only deployment guards on 2026-10-01

The installed CORS-fixed package passed the current app's full check using its
real build metadata; both managed CORS rules already matched. Five temporary
config files then exercised the normal config loader and complete check path
against live account metadata: renaming the private bucket warned about a new
empty bucket and unmigrated data; changing both names and jurisdiction to EU
warned for both bindings; removing the domain in a valid private-only config
blocked with the domain-remove repair; leaving the existing domain undeclared
while specifying another public hostname warned; and assigning the public
bucket to R2_PRIVATE blocked with the same repair.

The diagnostic allowed only management GET requests (78 total). Proposed default
and EU buckets were still absent afterwards, existing bucket/domain metadata
matched its initial snapshot, and the original app config was unchanged. Secret
names came from Wrangler; no app env files were parsed. Temporary variants had
no build, so only their upload/CORS/key lines were skipped as designed. This
checks live planning through real configuration files without deploying a
migration, creating EU buckets, enabling r2.dev or disconnecting domains.
The subsequent CORS preservation write and verification are recorded below.

## CORS preservation on 2026-10-01

The maintainer added the isolated public bucket's goribu-checkpoint-preserve GET
rule and changed only the managed rule's cache duration to 3599 seconds, then
deployed. Read-only verification confirmed the managed duration returned to
3600, the unrelated rule and all prior public rules matched exactly, and private
bucket CORS remained unchanged. The full app check reported no further CORS
upserts. The verifier made 31 management GETs and inspected secret names only.
The maintainer then completed the chained Worker-only deployment, no-direct
verification, direct-policy restoration, second deployment and final verification.
The commands were joined with &&, so the final phase required the no-direct
verifier to succeed first. The reported final Worker version was
56bf511f-d303-4070-8016-17487617c1f5. Final comparison again preserved every rule,
and the full check planned no upsert. Local source and fresh build metadata
confirmed the direct policies were restored, including the 150-MB public cap.
This completes the repeated-deploy and no-direct-fields CORS cases. The harmless
test-owned GET rule remains on the public test bucket; cleanup is separate.

## Binding conflicts and recovery on 2026-10-01

On the separate goribu-r2bindings Worker, the maintainer created a test-only R2
secret before managed deployment. Both check and deploy blocked with the exact
account-pinned secret-delete repair and the .env.production note. After the
maintainer deleted only that dummy secret and added a plaintext R2 variable
through dashboard settings, check succeeded with the replacement warning.
The maintainer then deployed without manually removing the plaintext variable.

Read-only verification confirmed R2 and R2_PRIVATE became r2_bucket bindings to
the existing test buckets, the R2 secret name was absent, and GORIBU_SECRET was
present. The public endpoint at
<https://goribu-r2bindings.aggelos-gesoulis.workers.dev/> returned HTTP 200,
no-store, successful reads through both bindings and a successful Worker-signing
check. It returns only fixed status fields, never values, refs or object bytes.
This completes secret-conflict recovery and plain-variable replacement; it
creates no additional buckets and does not close the remaining release checks.

## Browser lifecycle checks on 2026-10-01

The maintainer reported all ten checks passing at
<https://goribu-r2test.aggelos-gesoulis.workers.dev/r2-lifecycle-checks>, using
the CORS-fixed package based on 42d05c1. Replacement during start and during
Worker/direct PUT aborted the native request, revoked the previous preview and
submitted only the replacement. Goribu navigation during start and Worker/direct
PUT aborted the request and revoked its preview without a later form submission.
The observer forwarded real browser fetch and blob-URL operations unchanged.

Native reset and automatic Form reset after success cleared the hidden ref,
removed and revoked the preview, and left the next submission without a file.
An ordinary named File selected multipart encoding alongside a verified managed
ref; managed-only forms remained URL-encoded. A middleware login redirect became
the user-ready permission error, with no PUT or verified field. These results
complete the prepared lifecycle cases, not every account/deployment scenario.
Cancellation does not establish that an already-received object was removed.

## EU provisioning on 2026-10-01

The maintainer deployed goribu-r2eu with Wrangler 4.145.0, creating the EU
goribu-r2eu-media/files pair, connecting goribu-r2eu.anges244.com and generating
GORIBU_SECRET before upload. The reported Worker version was
cca2f466-fa15-42ad-ac57-4d8a6a00a113. Read-only verification confirmed both
deployed EU bindings, the enabled media domain, and no public access on the
private bucket. The full check reported existing resources without blocking
errors. Secret-name inspection confirmed the signing secret and no R2 key pair.

The Worker root returned HTTPS 200; the media domain returned HTTPS 404 for a
fresh nonexistent key, confirming TLS delivery but not object delivery. The
protected upload page correctly returned 503 while its test password was unset.
Verification used 16 management GETs and secret names only. EU object uploads,
downloads, CORS and presigned enforcement remain pending; this hostname still
uses the parent zone rather than a separate subdomain zone.

## EU Worker delivery on 2026-10-01

After setting the test-login secret, the maintainer confirmed that the EU app's
image and PDF uploads verified successfully, the public image link opened, and
the private PDF both opened inline and downloaded. R2 API keys remain unset on
this Worker, so these private links use the Worker download endpoint. This
establishes EU public-object delivery and private Worker delivery; EU presigned
URLs and direct uploads still require the fresh-Worker checkpoint.

## Fresh EU direct-Worker plan on 2026-10-01

Before creating goribu-r2eu-direct, a GET-only inspection using fresh built upload
metadata found the existing EU pair and domain, predicted
https://goribu-r2eu-direct.aggelos-gesoulis.workers.dev for both managed CORS rules,
and labeled the origin expected after first deploy. Missing R2 key names blocked
writes. EU CORS reads succeeded; a final comparison confirmed unchanged rules
and an absent Worker after 17 management GETs. No secret operations ran. The
secret-created draft, first deployment, CORS writes and direct transfers remain
pending.

## First EU direct-Worker deployment on 2026-10-01

After the maintainer entered the key pair and test password, check identified
the secret-created draft and labeled its workers.dev origin enabled by this
deploy. The first Goribu deployment then configured both EU CORS rules,
generated GORIBU_SECRET and enabled workers.dev. Wrangler 4.145.0 reported
Worker version a012564a-9886-41a6-acc9-c825fa484a48.

Read-only verification confirmed both intended EU bindings, all four required
secret names and an enabled workers.dev origin. The full check planned no
further CORS upsert. Both managed rules matched the exact origin, PUT, all four
headers and 3600-second cache duration. Unsigned OPTIONS to each EU S3 bucket
returned 204 allowing the origin and all four headers. The root and static
checkpoint page returned 200, while the login page challenged with 401.
Verification used 32 management GETs, two OPTIONS requests and public GETs;
no objects or settings changed. This establishes deployment from the disabled
draft and EU CORS configuration, not successful credential use or browser PUTs.
The browser direct-upload and presigned-download checks remain pending.

## EU direct transfers and downloads on 2026-10-01

The maintainer confirmed completion of the EU direct suite, private PDF checks
and optional large-file checks at
<https://goribu-r2eu-direct.aggelos-gesoulis.workers.dev/r2-direct-checks>.
This is the CORS-fixed package based on 42d05c1, deployed as
a012564a-9886-41a6-acc9-c825fa484a48. The suite targets the EU S3 hostname and
checks the successful browser/control PUTs, signed-header enforcement, replay
and concurrent overwrite refusal, upload metadata/digest/ref verification and
denial of an opaque browser origin. The PDF phase checks EU presigned GETs and
ASCII/Unicode attachment headers before presenting the three links.

The large-file phase uses 20,000,000 bytes through the Worker and 110,000,000
bytes direct, comparing binding-stream digests and verified sizes. These results
are recorded from the maintainer's aggregate confirmation; no per-check EU log
or fresh agent upload run is claimed. Together with the deployed-draft evidence,
they complete the prepared EU direct/first-deploy checkpoint.

## Automated follow-up preparation on 2026-10-01

A GET-only live check of a temporary EU configuration confirmed that removing
the declared domain blocks the now-private bucket and supplies the exact
domain-remove repair command with `-J eu`. Four management reads were made;
the app configuration, domain and bucket contents were unchanged.

The remaining runtime fixture has passed local typechecking, production build,
Worker HTTP checks and isolated Chrome automation. It covers controls disabled
during pending uploads, static delivery instrumentation, conflicting security
headers and EU Worker download cases. These local results are preparation only;
the fixture still needs a maintainer deployment and automated live verification.
Its separate test actions use short-lived signed authorization with an in-memory
private key and a deployed public verification key; existing app secrets are
not read or changed.

## Automated live runtime and privacy checks on 2026-10-01

After the maintainer deployed the prepared EU fixture, the agent completed its
HTTP and isolated Chrome checks at
<https://goribu-r2eu.aggelos-gesoulis.workers.dev/r2-final-page>.
Static document GET/HEAD responses omitted the marker applied to every normal
Worker response; an authenticated dynamic GET carried it. Static POST returned
405. While an upload and form submission were pending, the fieldset was disabled;
the final URL-encoded request retained the captured text, submitter and verified
file. Controlled HTML/SVG frames had opaque sandbox origins and ran no scripts.

EU Worker downloads passed exact GET/HEAD, ranges 206/416, ETag 304, If-Match
412, missing-object 404, malformed-token 403 and actual expiry after a successful
control. Fixed sandbox/nosniff headers won over deliberately conflicting app
headers and attempts to store conflicting metadata. The first browser automation
attempt failed during evaluation; a diagnostic retry completed every check.
No framework change was needed. Test objects were tiny synthetic files; existing
secret values were not read.

The already-public EU media bucket was then temporarily given r2.dev access and
its custom domain disabled. Both private-only and R2_PRIVATE configurations were
rejected by check and the real provisioning preflight; a configured-but-disabled
domain was also rejected. After restoring the domain and disabling r2.dev, both
private configurations were rejected for custom-domain exposure. A GET-only
boundary observed zero attempted framework writes, with a successful safe
configuration as control. Four test-setting PUTs and 92 framework management GETs
were used. Final read-back confirmed the original public settings, TLS settings,
CORS and private-bucket privacy. No object deletion or deployment ran in this
probe. This exercises deployment's actual R2 preflight, not a new CLI deployment.

A separate GET-only origin inventory found 14 zones, no routes in those zones,
and no custom domains for the test Worker. To exercise actual API pagination
without adding resources, the diagnostic requested two zones per page while
running the unchanged framework inventory logic. All seven pages were read,
all 14 zones inspected, and the resulting origin inventory matched the normal
single-page run. This covers live zone pagination, not multi-page domain/route
inventories or a denied zone. No active subdomain zone under anges244.com exists
in the available inventory.

## Origin discovery setup on 2026-10-01

The agent attached an unused test custom domain, goribu-r2origin.anges244.com,
to the existing EU direct Worker and created four narrow test routes. Live
inventory returned the custom HTTPS origin, the HTTPS-only and HTTP-only route
origins, both schemes for the scheme-less route, and the workers.dev origin.
The wildcard-host route produced a warning and contributed no origin. No DNS
records were created for the route-only hosts; this checks real route inventory,
not request delivery through those routes.

Before redeployment, both buckets' CORS rules remained unchanged and OPTIONS
from the new custom origin returned 403 without an allow-origin header. A small,
separately authorized browser probe passed local typechecking, build and Worker
upload-start checks. It adds no new secret requirement. Maintainer deployment,
actual browser PUT from the custom domain and cleanup of the journaled test
routes/domain remain pending; existing unrelated settings must be preserved.

## Origin redeployment and browser verification on 2026-10-01

After the maintainer redeployed goribu-r2eu-direct, read-only verification found
all six expected exact origins on both EU buckets, the wildcard excluded, and
unrelated CORS rules preserved. Both new-origin preflights returned 204 and a
full check reported no further upsert. An isolated Chrome session then loaded
the new custom-domain page, started an authenticated upload, sent an eight-byte
direct PUT with all four headers, and submitted the ref. The binding read-back
matched the bytes, size, type and upload metadata. The checkpoint authorization
was sent only to the app, never to R2.

Zone pagination was repeated against seven actual pages with the new origins
present. Requesting smaller route pages still returned all four routes in one
response; this did not establish multi-page route behavior. The custom-domain
inventory contained one item. The four journaled routes and the test custom
domain were removed, and both CORS policies were restored to their original
workers.dev-only origins. No Worker, bucket, object or secret was deleted. This
run does not waive unavailable account cases. A final read-only check confirmed
no pending CORS update or wildcard warning and refusal of the removed origin
on both buckets.

## Remaining checks after the EU checkpoint

The prepared runtime, transfer, privacy and origin batches are complete. Completed
suites do not need another routine run. The following account scenarios remain
untested; the maintainer accepted these gaps in the resolution below:

- Account-dependent cases: an active subdomain zone, multiple accounts, an
  account with no workers.dev subdomain, multi-page domain/route inventories and
  denied-zone permissions. Live zone pagination passed with a reduced page size.
  The accepted gaps remain unverified rather than passed.

## Release-readiness recommendation on 2026-10-01

**Recommendation: accept the following as documented live-verification gaps and
proceed to release preparation.** Acceptance was pending at this review; the
subsequent maintainer resolution is recorded below. No
remaining observed failure requires a framework change. This recommendation does
not mark these scenarios passed or change the release gate without review.

| Unverified live scenario | Evidence already available | Remaining uncertainty and recommendation |
| --- | --- | --- |
| Active subdomain-zone attachment | `r2-provisioning.test.js` checks most-specific zone selection, account ownership and passing the selected zone ID into attachment. Parent-zone attachment passed live in default and EU jurisdictions. | Cloudflare attachment under an independently active child zone has not run. Accept as non-blocking; retain the gap for a future suitable account. |
| Two-account deployment | `deploy-account.test.js` checks that provisioning, dry-run and upload use the selected account even with a different project env hint, for resource-free, D1 and KV apps. Real R2 deployments used the selected account. | Cross-account behavior has not run against two real accounts. Accept as non-blocking; retain the existing account-pinning regression. |
| Account without a workers.dev subdomain | `r2-origins.test.js` and `r2-provisioning.test.js` cover missing-subdomain refusal before writes and distinguish the expected missing code from an unrelated 404. | The precise real missing-resource response remains unconfirmed. An unexpected response still blocks rather than provisioning from an invented origin, but may give a less specific repair message. Accept as a diagnostic gap. |
| Multi-page Worker-domain/route inventories | Automated tests exercise 51-item inventories and reject repeated, missing or inconsistent pages. Seven real zone pages passed using the same pagination helper. | The available domain inventory has one item; the route endpoint returned all four items despite a smaller page request. Accept as non-blocking without claiming those endpoints were tested across multiple pages. |
| Denied route-read permission on a zone | Automated origin/provisioning tests inject permission failures, require the permissions repair and verify refusal before writes. The live login could read every available zone. | No live narrowly scoped credential was used to deny one zone. Accept as non-blocking; do not create or inspect extra credentials merely to repeat the covered failure path. |

The focused release-review run passed all 104 tests in five files, covering
origin discovery, provisioning, CORS, account pinning and deployment. The last full-suite result remains 127 files and
977 tests passed; the package-release workflow runs the full suite again against
the final clean commit. There is no need for another manual upload matrix.
Under the repository's version policy, R2 is a feature release: the proposed next
shared version is **0.9.0**, confirmed by the maintainer. No version change or
publication has been performed.

## Maintainer resolution on 2026-10-01

The maintainer chose to document the five scenarios above as untested and stop
pursuing additional accounts, Enterprise access or restricted credentials for
this checkpoint. These are accepted verification gaps for the planned **0.9.0**
release, not passed tests. This resolution closes the live checkpoint; it does
not bypass package validation, the release workflow's full test run, archive
review or publication approval.

Read-only availability checks found one accessible account, an existing
workers.dev subdomain, 14 zones, no Enterprise zones and no active child zones.
No additional accounts, credentials or domains were created for the final
scenario investigation. Completed live batches and their temporary-setting
cleanup remain recorded above. Future observations can reopen an accepted gap
if they reveal an actual defect.

## Ownership and evidence

The maintainer chooses the account, test app, bucket names and domains, and runs
installation, secret setup and deployment commands. Prepare and review the test
app and the printed plan before deploying. Do not use production user files.
Each app still has only Goribu's default and optional private bucket.

Never read secret values or parse app-authored env files. Inspect Worker secret
names with Wrangler only. Enter R2 credentials directly into Wrangler's prompt;
do not put them in scripts, command arguments or evidence. Goribu generates its
production signing secret itself. Do not publish signed URLs, refs, cookies or
raw API responses containing unrelated Worker bindings. For failures, record
HTTP status and error code rather than response bodies that may disclose values.

For each check record the date, commit, Wrangler/Chrome versions, test app URL,
transport and jurisdiction, expected result, observed result, and pass/fail.
Keep screenshots, sanitized summaries and detailed evidence in the ignored local
archive (`local-history/`), never in Git. Do not commit evidence files, even when
sanitized. The public decision row records what passed, when and against which
commit; public account/Worker identifiers and the final test URL are acceptable.
Keep every unchecked case pending; an unavailable account/zone scenario is not a pass. Provisioning and
deploy must never delete resources or objects. Any manual cleanup is a separate
maintainer action after evidence has been recorded.

## Prepare the test app

Use an isolated app based on `fixtures/basic-app`, running this checkout's
framework. Before deployment, give it its own Worker and bucket names and a
public media hostname in the selected account. Keep public files on a separate
hostname without app cookies. Use an actual active **subdomain zone** for the
zone-selection check, not just a hostname inside a parent zone.

Prepare these routes and controls using the public APIs in the guide:

- An authenticated profile page with `<Form>` and `<FileUpload name="avatar">`,
  a public `image/*` policy and a POST receiver that saves a verified key.
- A private PDF field and authenticated links generated by
  `req.r2.private.signedUrl()`, both inline and with a download filename.
- A drop/paste UI using `upload()` that submits its ref as JSON to its action.
- A static page posting to a separate upload action, and two fields in one form.
- In the direct-upload phase, a `video/mp4` field with `direct: true` and a
  policy above 100 MB. Use a modest file for ordinary checks and a larger test
  file for the cap/transport check if the account permits it.
- A test-only authenticated inspector for the test prefix. It can return an
  object's size, content type, `customMetadata["goribu-upload"]`, and a content
  digest. It must not return env values, credentials, signed refs, or arbitrary
  user objects. Inspect the object through the binding, not only the S3 API.

Use fresh keys for each attempt. For overwrite tests, reuse an issued target or
use a dedicated deterministic key under the test prefix. Middleware must protect
start requests, submission handlers and inspection. Test unauthenticated requests
separately. Do not add a handwritten Wrangler config or a production debug bypass.

## First deployment and repeated provisioning

Run commands below from the prepared app directory. Replace the account and
Worker placeholders with the reviewed non-secret identifiers. The examples use
`pnpm exec` to select the app's installed tools; installation is maintainer-owned.

1. Start with **no direct fields and no R2 credentials**, so signed downloads use
   the Worker endpoint. The Worker and both buckets should initially be absent.
2. The maintainer logs in, builds, and inspects the read-only plan:

   ```sh
   pnpm exec goribu cloudflare-login
   pnpm exec goribu build
   pnpm exec goribu check
   ```

3. Confirm that check changes nothing and lists the expected bucket, domain and
   signing-secret work. The maintainer then runs:

   ```sh
   pnpm exec goribu deploy
   ```

4. Verify the deployed public URL and secret **names**:

   ```sh
   CLOUDFLARE_ACCOUNT_ID=<account-id> pnpm exec wrangler secret list --name <worker-name>
   ```

   GORIBU_SECRET must exist. Verify a Worker download link works without reading
   the secret. Mint a link, redeploy without changing configuration, and confirm
   that the still-unexpired link works. Check should now report existing
   resources, and deploy should preserve objects and unrelated CORS rules.
5. Complete the Worker download/PDF checks below before adding R2 keys. Adding
   keys switches production signed downloads to presigned S3 URLs.
6. Add direct fields and build again. Check must teach the missing-key setup.
   The maintainer creates a bucket-scoped Object Read & Write R2 token in the
   dashboard, then enters each value into its prompt:

   ```sh
   CLOUDFLARE_ACCOUNT_ID=<account-id> pnpm exec wrangler secret put R2_ACCESS_KEY_ID --name <worker-name>
   CLOUDFLARE_ACCOUNT_ID=<account-id> pnpm exec wrangler secret put R2_SECRET_ACCESS_KEY --name <worker-name>
   pnpm exec goribu check
   pnpm exec goribu deploy
   ```

7. With a **separate new test Worker**, also exercise direct uploads on its first
   deploy: build its direct policies, set the two keys before deployment (creating
   a draft), and run check/deploy. If the draft has workers.dev disabled, the plan
   must include its predicted origin labeled “enabled by this deploy”. Confirm
   Goribu creates the signing secret on that draft and that browser PUTs work.
   Also inspect a missing Worker's read-only plan with no key-created draft:
   its predicted origin is labeled “expected after first deploy”; missing key
   names still block writes.

If a deliberately controlled final upload failure leaves a signing-secret draft,
record that it remains and a retry reuses it. Do not delete the draft to conceal
that behavior. Keep failure injection within the isolated test app.

## Account/API observations

Use the same selected account and authentication path as deploy. API paths below
are relative to `/client/v4`; use an authenticated diagnostic that outputs only
status, error codes and the specific non-secret fields under test. Never dump a
whole Worker settings response.

| Check | Procedure and required observation | Status |
| --- | --- | --- |
| Default jurisdiction header | On the default-jurisdiction pair, exercise bucket detail, domain, CORS and creation calls with `cf-r2-jurisdiction: default`. Confirm the live API accepts it and read-back matches. Repeat with an EU pair and `eu`; signatures must use the EU host. | Passed default and EU provisioning/CORS; EU signed transfers confirmed by maintainer, 2026-10-01 |
| Missing bucket | GET `/accounts/{account}/r2/buckets/{unused-name}` with the intended jurisdiction: confirm HTTP 404 and code **10006**, then the create plan. Unrelated errors must not become a create plan. | Passed, default jurisdiction, 2026-09-30 |
| Missing Worker | GET `/accounts/{account}/workers/scripts/{unused-name}/settings`: confirm HTTP 404 and code **10007**, then the missing-Worker plan. | Passed, default jurisdiction, 2026-09-30 |
| Missing account subdomain | On an account that actually has no workers.dev subdomain, GET `/accounts/{account}/workers/subdomain`: confirm whether it returns HTTP 404 and **10007**. Check must print the registration repair. If no such account is available, do not remove an existing subdomain to simulate it. | Untested; accepted verification gap, 2026-10-01 |
| Domain/zone lookup (S3) | Attach the public bucket hostname under an active subdomain zone using the normal deploy login. Verify the selected zone belongs to the account, the domain is enabled after attachment, TLS minimum is 1.2, and a public object is reachable. Disabled existing connections must block rather than be overwritten. | Parent-zone attachment and disabled-connection refusal passed; active subdomain-zone attachment untested, accepted gap 2026-10-01 |
| Bucket privacy | In isolated buckets, exercise r2.dev and enabled custom-domain conflicts on R2_PRIVATE and on a private-only default bucket. Check/deploy must stop before writes; an extra public-bucket custom domain only warns. Restore public access manually before continuing. | Passed 2026-10-01: r2.dev and custom-domain conflicts for both private binding shapes; actual provisioning preflight attempted zero writes; original settings restored |
| Origin inventory | Verify enabled workers.dev, an existing disabled Worker re-enabled by deploy, Worker custom domains and exact-host routes. Wildcard hosts warn and are excluded. Schemed routes yield that scheme; scheme-less routes yield HTTP and HTTPS. Newly added domains require a redeploy before CORS permits them. | Enabled workers.dev and disabled-draft re-enablement passed 2026-10-01; Passed 2026-10-01: custom domain and exact-host schemes discovered, wildcard excluded, new origin refused before redeploy and allowed afterward with a real browser PUT |
| Pagination and permissions | Use an account inventory spanning multiple pages of zones/domains/routes and verify all pages contribute relevant origins. A denied zone must fail with the permissions repair, never silently omit origins. Leave the multi-page scenario pending if the inventory is too small. | Live zone pagination passed across seven actual pages using a diagnostic page size of two, 2026-10-01; multi-page domains/routes and denied-zone permission untested, accepted gaps 2026-10-01 |
| CORS preservation | Add an unrelated test CORS rule manually, deploy, and confirm it is unchanged while only goribu-uploads is upserted. Repeat deployment. Buckets with no direct fields remain untouched. | Passed 2026-10-01: forced upsert, no-direct deployment, restoration and repeat verification |
| Bucket-change warnings | On a deployed test app, change r2.name to an unused name, then separately change jurisdiction to an unused jurisdiction/name combination. Run check and confirm the old/new binding, “new empty bucket” warning and no-data-migration repair. Restore config between cases. Check must create nothing and preserve old bytes. | Passed 2026-10-01 via temporary config files and live GET-only check, including default-to-EU plan |
| Removed/undeclared domain diagnostic | On a valid public-only config, remove r2.domain while its enabled domain remains connected. Check must print the domain-remove command (including -J for EU) and block because the bucket is now declared private. Do not disconnect automatically. Separately leave an extra undeclared domain on a still-public bucket: this case warns. Restore the declared domain before continuing. | Passed default-jurisdiction block/warning and live EU domain repair, 2026-10-01 |
| Secret binding conflict | On an isolated pre-R2 Worker, create a dummy secret named R2 without reading any existing value, then configure managed R2. Check/deploy must block with the account-pinned wrangler secret delete R2 --name repair and the .env.production removal note. Inspect names only. Run the repair only for this test-owned dummy; secrets have no jurisdiction flag. Repeat deployment to confirm recovery. | Passed 2026-10-01: check/deploy block, exact repair, removal and successful recovery |
| Plain-variable binding replacement | On a separate pre-R2 test Worker, establish a harmless plain var named R2 through dashboard settings, then deploy the Goribu app with managed R2. Confirm the replacement warning and that the deployed R2 binding is an r2_bucket; exercise req.r2 against it. This must succeed without manually deleting the plain var first. | Passed 2026-10-01: warning, automatic replacement, live binding reads and signing |
| Account pinning (shared deploy fix) | If two accessible accounts exist, explicitly select account A in the deploy process environment and have the maintainer put CLOUDFLARE_ACCOUNT_ID=B in the isolated app's .env. Do not parse that file. Confirm all provisioned resources and the Worker land in A, with none created in B; repeat with a non-R2 app to cover the shared fix. Use names/IDs and resource reads as evidence. With one account, retain the untested status. | Untested; accepted verification gap, 2026-10-01 |

## Browser uploads and form behavior

Use a real Chrome session on the deployed app. Record the URL with signed query
strings removed. Check public avatar, private PDF and drop-zone flows through the
UI, and inspect the verified handler result and stored metadata.

- [x] Submit during uploads: pending becomes true; the final handler runs after
  all current transfers settle. The enhanced form request is URL-encoded and
  contains refs, not file bytes.
- [x] Fields disabled by pending retain accepted values. Automated live Chrome
  observed a disabled fieldset during upload/submission and verified the captured
  text, submitter and file in the final URL-encoded request.
- [x] Pick twice while uploading: the previous request is aborted, its preview is
  revoked, and only the replacement ref is submitted. Navigate away during both
  start and PUT; no later submission or state update occurs.
- [x] After success, test native reset and `<Form reset>`: preview disappears,
  hidden ref is cleared/disabled, and the next submission has no old file.
- [x] A failed upload leaves its field absent for server validation. Error text
  has no `[Goribu]` prefix. A cross-route oversized start includes the receiving
  policy's limit without adding picker hints. Wrong declared type is rejected.
- [x] Unauthenticated start is refused by middleware; a login redirect becomes
  the permission message. No target/ref or object is created.
- [x] Forge a ref, submit it to another field/route, and submit an expired ref:
  each field is absent. Test a PUT after its 60-second expiry and a ref after
  its one-hour expiry using real time, without exposing the signing secret or
  adding an expiry bypass. Remember refs bind route patterns, not individual
  dynamic parameters or user IDs.
- [x] Start over an existing deterministic key, skip PUT, and submit the new ref;
  repeat after an actual conflict. The old object must remain unchanged and
  must not be accepted as the new upload, even with matching size/type.
- [x] A static form page's upload start reaches the separate Worker action. A
  separate ordinary named file input still uses multipart; managed FileUpload
  fields alone do not.
- [x] Confirm the deployed static form document is a Static Assets load without
  a Worker invocation. Instrumented static GET/HEAD omitted the header applied
  to every normal Worker response; an authenticated dynamic GET carried it.

## Direct upload spikes and browser CORS

Use fresh targets and fresh test keys for independent cases. Keep signed targets
in memory; they are bearer credentials. Capture only sanitized observations.
A successful control PUT must precede enforcement claims so an invalid key/token
cannot make every negative test appear to pass.

| Check | Procedure and required observation | Status |
| --- | --- | --- |
| Browser preflight | From the real app origin, confirm OPTIONS and PUT succeed against R2. Use a public direct field to exercise **content-type, cache-control, if-none-match, x-amz-meta-goribu-upload** together. Confirm the exact origin and PUT are permitted. A non-allowed origin must fail in the browser. A curl OPTIONS check alone is insufficient. | Passed default; EU passed per maintainer confirmation, 2026-10-01 |
| Size/type enforcement (S1) | Start with an allowed declared size/type. For separate fresh targets, send a body with a different actual length, or change the signed Content-Type. R2 must reject the modified requests and the inspector must find no object. Browser fetch sets Content-Length from the body; do not try to set that forbidden header. Then verify matching bytes/type succeed. Test shorter and longer bodies. | Passed default; EU passed per maintainer confirmation, 2026-10-01 |
| Conditional PUT (S2) | Complete a valid direct PUT, then replay the same target with altered bytes of the same length: it must fail and preserve the digest. Race two PUTs for a fresh target: exactly one succeeds. Removing/changing the signed If-None-Match header must fail. Repeat replay/race via the Worker transport to confirm live binding onlyIf behavior too. | Passed default; EU passed per maintainer confirmation, 2026-10-01 |
| Upload identity | Send direct PUT with x-amz-meta-goribu-upload. Binding head() must return that exact ID as customMetadata["goribu-upload"], lowercase, with matching size/type. Changing or omitting the signed header must fail. Submit the successful ref and confirm req.body() accepts the object. | Passed default; EU passed per maintainer confirmation, 2026-10-01 |
| Production streaming (S4) | Upload through the deployed Worker with a known length, including a representative larger file below its policy cap. Confirm correct size/digest and success using the production streaming path. Use Worker observations plus the emitted code path to distinguish this from dev buffering; do not infer streaming solely from a small successful upload. | Passed default and EU, 20,000,000 bytes; production stream path inspected, 2026-10-01 |
| Direct large file | Upload a file above 100 MB through a field whose direct policy allows it. Confirm bytes go to R2, not through the Worker, and the verified ref is accepted. Record size and account limits; an unperformed large-file test remains pending. | Passed default and EU, 110,000,000 bytes on the test account, 2026-10-01 |

If any enforcement spike fails, stop release and bring the observed behavior
back for a design decision. Do not weaken overwrite protection, add head-then-put,
remove signed headers to fix CORS, or silently accept verification-only enforcement.

## Downloads and sandbox behavior

Run the Worker-link cases during the no-R2-credentials phase. Run presigned cases
after adding keys; include EU jurisdiction in the matrix. Checked items below
have default-jurisdiction evidence. EU Worker protocol, expiry, active-content
isolation and header overrides passed automated live checks. EU Worker PDF/public
delivery and presigned PDF/filename checks are also confirmed.

- [x] Private Worker links: full GET, HEAD, a single satisfiable range (206), an
  unsatisfiable range (416), ETag validation (304), missing object, expired token,
  and a malformed token. Confirm fixed CSP sandbox and nosniff on successes and
  failures. Check that the private bucket has no direct public access.
- [x] Open a private PDF inline in Chrome through a Worker link. Record the
  browser version and whether the viewer works. Also test an attachment link.
  If inline PDFs are blocked, document “use download or presigned links for
  PDFs” in the R2 guide. **Never add allow-same-origin to the sandbox.**
- [x] Serve controlled HTML and SVG test files from Worker download links. Their
  scripts must not run as the app; confirm sandbox/nosniff on the responses.
- [x] Attempt to override sandbox/nosniff using stored metadata or app-wide
  headers and confirm the fixed headers still win live. The automated EU fixture
  supplied conflicting global defaults and attempted conflicting stored metadata;
  successes and failures retained the fixed headers, and scripts stayed blocked.
- [x] Presigned GET filename override (S5): test an ASCII and a Unicode filename,
  inspect Content-Disposition, and confirm the actual downloaded filename.
  Also open a private PDF inline through a presigned URL. Record any service
  limitation before changing the public behavior.
- [x] Verify that `req.r2.url()` returns the configured HTTPS custom-domain URL,
  including encoded spaces/Unicode. Fetch a public uploaded object through that
  URL and confirm its bytes and `Cache-Control: public, max-age=31536000, immutable`.
  Confirm the production `/_goribu/r2/public/*` path is 404; local public-file
  serving stays dev-only.

## Close the checkpoint

All rows and checkboxes above need observed evidence or an explicitly reviewed
resolution. Record any failure with a minimal reproduction, fix it, run the
relevant local regression, and repeat its live scenario. Update the R2 guide with
the PDF outcome and any resolved service limitations. Keep detailed evidence in
`local-history/`; do not commit it or link private archive files from public docs.
Append a decision row stating which checks passed and which remain pending,
the tested commit/date, and the final public test URL.

The maintainer resolution above closes this checkpoint with the five stated
verification gaps. R2 remains unreleased until package preparation, validation
and publication are completed through the normal release workflow.
