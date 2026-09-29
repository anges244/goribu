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
  const plan = await inspectR2({ projectRoot, appConfig, client, access, listSecrets: options.listSecrets });
  stdout.write(formatR2Plan(plan));
  assertR2PlanSafe(plan);
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
  return plan;
}
