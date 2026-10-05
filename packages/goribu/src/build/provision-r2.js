import { getCloudflareAccess } from "./cloudflare-access.js";
import { createR2ManagementClient } from "./cloudflare-r2.js";
import { assertR2PlanSafe, createR2Plan, formatR2Plan, inspectR2 } from "./inspect-r2.js";

/** Inspect buckets, domain ownership, and secret names before creating resources. */
export async function provisionR2(options) {
  const { projectRoot, appConfig } = options;
  if (appConfig.r2 === undefined) return null;
  const stdout = options.stdout ?? process.stdout;
  const access = await (options.getAccess ?? getCloudflareAccess)({ projectRoot });
  const client = createR2ManagementClient({ access, fetch: options.fetch });
  const plan = await inspectR2({ projectRoot, appConfig, client, access, appDomain: options.appDomain, listSecrets: options.listSecrets, requireUploads: true });
  stdout.write(formatR2Plan(plan));
  // The plan just printed each Blocked reason; point at it rather than repeat it.
  if (plan.errors.length) throw new Error("[Goribu] R2 cannot proceed. Resolve the Blocked items above, then rerun `goribu deploy`. No Cloudflare resources were changed.");
  // Never upload direct-upload code that cannot sign. Deploy asks for missing
  // keys before the Worker upload; without a terminal, stop before the first write.
  if (plan.uploads.keys === "missing" && !options.canPrompt) {
    throw new Error(`[Goribu] R2 direct uploads need the Worker secrets ${plan.uploads.missingKeys.join(" and ")}, and goribu deploy can only ask for them in a terminal. Run \`goribu deploy\` once from a terminal: it creates the upload buckets, then asks for the keys of an R2 API token scoped to them. Later deploys, including CI, reuse the stored secrets. No Cloudflare resources were changed.`);
  }
  for (const bucket of plan.buckets) {
    if (bucket.state === "existing") continue;
    await client.createBucket(bucket.name, bucket.jurisdiction);
    // Do not trust creation alone to establish safe public-access settings.
    const remote = await client.bucket(bucket.name, bucket.jurisdiction);
    if (remote === null) throw new Error(`[Goribu] R2 bucket ${bucket.name} was not found after creation. Rerun \`goribu check\` before deploying; no cleanup or deletion was attempted.`);
    assertR2PlanSafe(createR2Plan([{ ...bucket, state: "existing", remote }]));
    stdout.write(`✓ Created R2 bucket ${bucket.name} (${bucket.jurisdiction})\n`);
  }
  if (plan.domain?.action === "connect") {
    const { bucket, jurisdiction, name, zoneId } = plan.domain;
    await client.attachDomain(bucket, jurisdiction, name, zoneId);
    const remote = await client.bucket(bucket, jurisdiction);
    if (!remote?.domains.some((domain) => domain.domain === name && domain.enabled)) throw new Error(`[Goribu] R2 domain ${name} was not enabled after attachment. Inspect its status in Cloudflare and rerun \`goribu check\`; no domain was disconnected.`);
    stdout.write(`✓ Connected R2 domain ${name}; DNS and certificate activation may still be pending.\n`);
  }
  for (const entry of plan.uploads.cors) {
    if (await client.upsertUploadCors(entry.bucket, entry.jurisdiction, entry.origins)) {
      stdout.write(`✓ Updated R2 upload CORS for ${entry.bucket} (${entry.jurisdiction})\n`);
    }
  }
  return plan;
}
