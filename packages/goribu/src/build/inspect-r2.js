import { getCloudflareAccess } from "./cloudflare-access.js";
import { createR2ManagementClient } from "./cloudflare-r2.js";
import { listR2SecretNames } from "./r2-secrets.js";

export function declaredR2Buckets(appConfig) {
  if (appConfig.r2 === undefined) return [];
  const { name, domain, private: privateBucket, jurisdiction = "default" } = appConfig.r2;
  return [
    { binding: "R2", name, jurisdiction, domain },
    ...(privateBucket ? [{ binding: "R2_PRIVATE", name: privateBucket.name, jurisdiction }] : []),
  ];
}

/** Inspect only metadata, against the same account deploy uses, without writes. */
export async function inspectR2(options) {
  const { projectRoot, appConfig } = options;
  if (appConfig.r2 === undefined) return null;
  const access = options.access ?? await (options.getAccess ?? getCloudflareAccess)({ projectRoot });
  const client = options.client ?? createR2ManagementClient({ access, fetch: options.fetch });
  const worker = await client.worker(appConfig.name);
  const buckets = [];
  for (const declaration of declaredR2Buckets(appConfig)) {
    const remote = await client.bucket(declaration.name, declaration.jurisdiction);
    buckets.push(Object.freeze({ ...declaration, state: remote === null ? "missing" : "existing", remote }));
  }
  const plan = createR2Plan(buckets, worker.bindings);
  const first = buckets[0];
  let domain = null;
  if (first.domain !== undefined) {
    const connected = first.remote?.domains.find((entry) => entry.domain === first.domain);
    if (connected && !connected.enabled) throw new Error(`[Goribu] Configured R2 domain ${first.domain} is connected but disabled. Enable it in Cloudflare R2 bucket settings, or change r2.domain, then rerun \`goribu check\`. Goribu does not overwrite existing domain settings.`);
    const zone = await client.zone(first.domain);
    domain = Object.freeze({ name: first.domain, bucket: first.name, jurisdiction: first.jurisdiction, zoneId: zone.id, action: connected ? "none" : "connect" });
  }
  const names = worker.exists ? await (options.listSecrets ?? listR2SecretNames)({ projectRoot, appConfig, access }) : [];
  return Object.freeze({ ...plan, domain, signingSecret: names.includes("GORIBU_SECRET") ? "existing" : "missing", workerExists: worker.exists });
}

export function createR2Plan(buckets, previous = []) {
  const warnings = [];
  const errors = [];
  for (const bucket of buckets) {
    const old = previous.find((binding) => binding.binding === bucket.binding);
    if (old && old.type !== "r2_bucket") {
      warnings.push(`Deploy replaces the existing ${old.type} binding named ${old.binding} with the managed R2 bucket ${bucket.name} (${bucket.jurisdiction}). Update app code that used the previous binding.`);
    } else if (old && (old.name !== bucket.name || old.jurisdiction !== bucket.jurisdiction)) {
      warnings.push(`${bucket.binding} changes from ${old.name} (${old.jurisdiction}) to ${bucket.name} (${bucket.jurisdiction}). ${bucket.state === "missing" ? "A new empty bucket will be created." : "The target bucket already exists."} Existing stored keys still refer to the old bucket's objects. Goribu does not move data; restore the previous configuration or migrate the data before switching.`);
    }
    if (bucket.remote?.devUrlEnabled && bucket.domain === undefined) {
      errors.push(`Private bucket ${bucket.name} (${bucket.jurisdiction}) has public r2.dev access enabled. Disable it with \`wrangler r2 bucket dev-url disable ${bucket.name}${jurisdictionFlag(bucket.jurisdiction)}\`, then rerun \`goribu check\`.`);
    }
    for (const domain of bucket.remote?.domains ?? []) {
      if (!domain.enabled) continue;
      const repair = `Goribu never disconnects domains. To remove it yourself, run \`wrangler r2 bucket domain remove ${bucket.name} --domain ${domain.domain}${jurisdictionFlag(bucket.jurisdiction)}\`.`;
      if (bucket.domain === undefined) {
        errors.push(`Private bucket ${bucket.name} (${bucket.jurisdiction}) has public access through the enabled custom domain ${domain.domain}. ${repair} Then rerun \`goribu check\`.`);
      } else if (domain.domain !== bucket.domain) {
        warnings.push(`Bucket ${bucket.name} remains public at ${domain.domain}, which is not declared in r2.domain. ${repair}`);
      }
    }
  }
  for (const old of previous) {
    if (!buckets.some((bucket) => bucket.binding === old.binding)) {
      warnings.push(old.type === "r2_bucket"
        ? `${old.binding} is removed from the Worker; bucket ${old.name} (${old.jurisdiction}) and all its objects remain unchanged.`
        : `Deploy removes the existing ${old.type} binding named ${old.binding}; no managed bucket uses that binding in this configuration. Update app code that used the previous binding.`);
    }
  }
  return Object.freeze({ buckets: Object.freeze(buckets), warnings: Object.freeze(warnings), errors: Object.freeze(errors) });
}

export function assertR2PlanSafe(plan) {
  if (plan?.errors.length) throw new Error(`[Goribu] R2 cannot proceed. ${plan.errors.join(" ")}`);
}

export function formatR2Plan(plan) {
  if (plan === null || plan === undefined) return "";
  return ["R2", ...plan.buckets.map((bucket) =>
    `  ${bucket.state === "missing" ? "create bucket" : "existing bucket"}  ${bucket.name} (${bucket.jurisdiction}) -> ${bucket.binding}`),
  ...plan.warnings.map((warning) => `  Warning: ${warning}`),
  ...plan.errors.map((error) => `  Blocked: ${error}`),
  ...(plan.domain ? [`  ${plan.domain.action === "connect" ? "connect domain" : "existing domain"}  ${plan.domain.name} -> ${plan.domain.bucket} (${plan.domain.jurisdiction})`] : []),
  ...(plan.signingSecret ? [plan.signingSecret === "missing" ? "  create secret    GORIBU_SECRET (generated; an app-provided .env.production value takes precedence on upload)" : "  existing secret  GORIBU_SECRET",
    ...(plan.workerExists === false ? ["  First deploy: Wrangler creates a draft Worker to hold the secret before the final upload."] : [])] : []),
  ""].join("\n");
}

function jurisdictionFlag(jurisdiction) {
  return jurisdiction === "default" ? "" : ` -J ${jurisdiction}`;
}
