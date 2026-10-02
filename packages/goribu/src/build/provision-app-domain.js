import { getCloudflareAccess } from "./cloudflare-access.js";
import { createAppDomainManagementClient } from "./cloudflare-app-domain.js";
import { inspectAppDomain } from "./inspect-app-domain.js";

/** Run only after Worker deployment succeeds. Never reuse a pre-upload plan. */
export async function provisionAppDomain(options) {
  const { projectRoot, appConfig } = options;
  if (appConfig.domain === undefined) return null;
  const stdout = options.stdout ?? process.stdout;
  const access = options.access ?? await (options.getAccess ?? getCloudflareAccess)({ projectRoot });
  const client = options.client ?? createAppDomainManagementClient({ access, fetch: options.fetch });
  const plan = await inspectAppDomain({ ...options, access, client });
  if (plan.action === "none") return plan;
  // Cloudflare also enforces the no-replacement flags when attaching, covering
  // conflicts that appear between this fresh inspection and the write.
  await client.attachDomain(plan);
  const confirmed = (await client.domains()).find((domain) => domain.hostname === plan.name);
  if (!confirmed || confirmed.service !== plan.worker || confirmed.environment !== "production" || confirmed.zoneId !== plan.zoneId) {
    throw new Error(`[Goribu] App domain ${plan.name} could not be confirmed after attachment. Inspect the Worker's Domains & Routes for concurrent changes and rerun \`goribu check\`, then \`goribu deploy\`. No domain was disconnected; DNS and certificate activation may still be pending.`);
  }
  stdout.write(`✓ Connected app domain https://${plan.name}; DNS and certificate activation may still be pending.\n`);
  return plan;
}
