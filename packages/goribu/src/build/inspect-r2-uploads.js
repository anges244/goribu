import { mergeR2UploadCors } from "./r2-cors.js";

const KEY_NAMES = ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
const ACTIVE_TYPES = new Set(["text/html", "text/*", "image/svg+xml", "image/*", "application/xhtml+xml", "application/*"]);

export async function inspectR2Uploads({ metadata, buckets, client, names, access, appConfig, workerExists }) {
  if (metadata === null) return { builtAt: null, cors: [], warnings: [], errors: [] };
  const direct = new Set(), warnings = [], errors = [], cors = [];
  for (const route of metadata.routes) {
    for (const [field, policy] of Object.entries(route.fields)) {
      const bucket = buckets.find((item) => item.binding === (policy.private ? "R2_PRIVATE" : "R2"));
      if (bucket.domain && policy.accept.some((type) => ACTIVE_TYPES.has(type))) {
        warnings.push(`Public upload ${JSON.stringify(route.id)} field ${JSON.stringify(field)} accepts active HTML or SVG content. Serve untrusted files on a separate media domain without app cookies, or restrict accept.`);
      }
      if (policy.direct) direct.add(bucket.binding);
    }
  }
  if (direct.size === 0) return { builtAt: metadata.builtAt, cors, warnings, errors, keys: "not-needed" };
  const targets = buckets.filter((bucket) => direct.has(bucket.binding));
  const missing = KEY_NAMES.filter((name) => !names.includes(name));
  if (missing.length) errors.push(missingKeys(missing, targets, appConfig, access));
  const discovery = await client.origins(appConfig.name, workerExists);
  warnings.push(...discovery.warnings);
  for (const bucket of targets) {
    const rules = bucket.state === "missing" ? [] : await client.cors(bucket.name, bucket.jurisdiction);
    const action = mergeR2UploadCors(rules, discovery.origins).changed ? "upsert" : "none";
    cors.push({ bucket: bucket.name, jurisdiction: bucket.jurisdiction, origins: discovery.origins, action,
      ...(discovery.enabledByDeploy ? { enabledByDeploy: discovery.enabledByDeploy } : {}),
      ...(discovery.expectedAfterFirstDeploy ? { expectedAfterFirstDeploy: true } : {}) });
  }
  return { builtAt: metadata.builtAt, cors, warnings, errors, keys: missing.length ? "missing" : "existing" };
}

export function formatR2Uploads(uploads) {
  if (!uploads) return [];
  if (uploads.builtAt === null) return ["  Upload CORS and R2 key checks skipped: run goribu build first. Bucket, domain and signing-secret checks still apply."];
  const keys = uploads.keys === "not-needed" ? "not required (no direct fields)"
    : uploads.keys === "existing" ? "both secret names exist" : "missing; see setup steps above";
  return [
    `  Upload policies from build ${uploads.builtAt}; source edits since that build are not inspected. Deploy always builds fresh.`,
    `  R2 upload keys: ${keys}`,
    ...(uploads.cors.length ? uploads.cors.map((entry) =>
      `  ${entry.action === "none" ? "existing" : entry.action} CORS  goribu-uploads -> ${entry.bucket} (${entry.jurisdiction}); origins: ${entry.origins.map((origin) => origin + (origin === entry.enabledByDeploy ? " (enabled by this deploy)" : "")).join(", ") || "none"}${entry.expectedAfterFirstDeploy ? " (expected after first deploy)" : ""}`)
      : ["  Upload CORS: not required (no direct fields); existing rules are preserved."]),
  ];
}

function missingKeys(missing, buckets, appConfig, access) {
  return `R2 direct uploads need Worker secrets: ${missing.join(", ")}. One-time setup:\n` +
    "  1. Cloudflare dashboard > R2 > Manage API tokens > Create API token.\n" +
    `  2. Select Object Read & Write and scope it to ${buckets.map((bucket) => `${bucket.name} (${bucket.jurisdiction})`).join(", ")} in account ${access.accountId}.\n` +
    "  3. Enter each missing value into Wrangler's prompt yourself:\n" +
    missing.map((name) => `     CLOUDFLARE_ACCOUNT_ID=${access.accountId} wrangler secret put ${name} --name ${appConfig.name}`).join("\n") +
    "\n  Then rerun `goribu deploy`. A first secret may create a draft Worker. Goribu checks names with `wrangler secret list` only; entries in .env.production cannot satisfy this check because Goribu never reads that file.";
}
