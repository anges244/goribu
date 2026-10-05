import { mergeR2UploadCors } from "./r2-cors.js";

export const R2_UPLOAD_KEYS = Object.freeze(["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]);
const ACTIVE_TYPES = new Set(["text/html", "text/*", "image/svg+xml", "image/*", "application/xhtml+xml", "application/*"]);

export async function inspectR2Uploads({ metadata, buckets, client, names, access, appConfig, appDomain, workerExists }) {
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
  // Missing keys are a deploy step, not a blocker: deploy creates the buckets
  // first, so the token can be scoped to them, then asks for the keys.
  const missing = R2_UPLOAD_KEYS.filter((name) => !names.includes(name));
  const discovery = await client.origins(appConfig.name, workerExists, appConfig.workersDev);
  let origins = discovery.origins;
  // A newly configured domain is attached after Worker upload. Include its
  // verified origin now so the first visit already has working direct uploads.
  let connectedByDeploy;
  if (appConfig.domain !== undefined) {
    if (appDomain?.name !== appConfig.domain || appDomain.worker !== appConfig.name ||
        appDomain.accountId !== access.accountId || !["connect", "none"].includes(appDomain.action)) {
      throw new Error("[Goribu] The configured application domain has not been inspected for R2 upload CORS. Rerun `goribu check` or `goribu deploy` to verify its zone and ownership before provisioning.");
    }
    const origin = `https://${appDomain.name}`;
    origins = [...new Set([...origins, origin])].sort();
    if (appDomain.action === "connect") connectedByDeploy = origin;
  }
  warnings.push(...discovery.warnings);
  for (const bucket of targets) {
    const rules = bucket.state === "missing" ? [] : await client.cors(bucket.name, bucket.jurisdiction);
    const action = mergeR2UploadCors(rules, origins).changed ? "upsert" : "none";
    cors.push({ bucket: bucket.name, jurisdiction: bucket.jurisdiction, origins, action,
      ...(discovery.enabledByDeploy ? { enabledByDeploy: discovery.enabledByDeploy } : {}),
      ...(connectedByDeploy ? { connectedByDeploy } : {}),
      ...(discovery.expectedAfterFirstDeploy ? { expectedAfterFirstDeploy: true } : {}) });
  }
  return { builtAt: metadata.builtAt, cors, warnings, errors, keys: missing.length ? "missing" : "existing", missingKeys: missing };
}

export function formatR2Uploads(uploads) {
  if (!uploads) return [];
  if (uploads.builtAt === null) return ["  Upload CORS and R2 key checks skipped: run goribu build first. Bucket, domain and signing-secret checks still apply."];
  const keys = uploads.keys === "not-needed" ? "not required (no direct fields)"
    : uploads.keys === "existing" ? "both secret names exist"
    : `missing ${uploads.missingKeys.join(", ")}. goribu deploy creates the upload buckets, then asks for the keys in a terminal; without a terminal it stops before any change.`;
  return [
    `  Upload policies from build ${uploads.builtAt}; source edits since that build are not inspected. Deploy always builds fresh.`,
    `  R2 upload keys: ${keys}`,
    ...(uploads.cors.length ? uploads.cors.map((entry) =>
      `  ${entry.action === "none" ? "existing" : entry.action} CORS  goribu-uploads -> ${entry.bucket} (${entry.jurisdiction}); origins: ${entry.origins.map((origin) => origin + (origin === entry.enabledByDeploy ? " (enabled by this deploy)" : origin === entry.connectedByDeploy ? " (connected by this deploy)" : "")).join(", ") || "none"}${entry.expectedAfterFirstDeploy ? " (expected after first deploy)" : ""}`)
      : ["  Upload CORS: not required (no direct fields); existing rules are preserved."]),
  ];
}
