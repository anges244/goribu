import { getCloudflareAccess } from "./cloudflare-access.js";
import { createAppDomainManagementClient } from "./cloudflare-app-domain.js";

/** Read-only preflight. An existing attachment needs no DNS changes. */
export async function inspectAppDomain(options) {
  const { projectRoot, appConfig } = options;
  if (appConfig.domain === undefined) return null;
  const access = options.access ?? await (options.getAccess ?? getCloudflareAccess)({ projectRoot });
  const client = options.client ?? createAppDomainManagementClient({ access, fetch: options.fetch });
  const name = appConfig.domain, worker = appConfig.name;
  const zone = await client.zone(name);
  const domains = await client.domains();
  const existing = domains.find((domain) => domain.hostname === name);
  if (existing && (existing.service !== worker || existing.environment !== "production" || existing.zoneId !== zone.id)) {
    throw new Error(`[Goribu] App domain ${name} is already connected to Worker ${existing.service} (${existing.environment}) or a different zone. Choose another domain, or deliberately disconnect the existing attachment in Cloudflare Workers & Pages > Domains & Routes, then rerun \`goribu check\`. Goribu does not reassign occupied hostnames.`);
  }
  const otherDomains = domains.filter((domain) => domain.service === worker && domain.environment === "production" && domain.hostname !== name)
    .map((domain) => domain.hostname).sort();
  const warnings = [];
  if (!existing && await client.previewDomain({ name, worker, zoneId: zone.id }) === null) {
    warnings.push(`Worker ${worker} does not exist yet. Cloudflare's domain conflict preview will run after the first Worker upload; attachment still refuses replacements.`);
  }
  return Object.freeze({ name, worker, accountId: access.accountId, zoneId: zone.id,
    action: existing ? "none" : "connect", otherDomains: Object.freeze(otherDomains), warnings: Object.freeze(warnings) });
}

export function formatAppDomainPlan(plan) {
  if (plan === null || plan === undefined) return "";
  return ["App domain", `  ${plan.action === "connect" ? "connect domain" : "existing domain"}  ${plan.name} -> ${plan.worker}`,
    ...plan.otherDomains.map((name) => `  also connected  ${name} (not managed by Goribu)`),
    ...plan.warnings.map((warning) => `  Warning: ${warning}`), ""].join("\n");
}
