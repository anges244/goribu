import { CLOUDFLARE_AUTH_HELP } from "./wrangler-diagnostics.js";

const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const JURISDICTIONS = new Set(["default", "eu", "us", "fedramp", "fedramp-high"]);

/** Metadata reads and bucket creation only. No object or deletion API is exposed. */
export function createR2ManagementClient({ access, fetch: fetchImpl = globalThis.fetch }) {
  if (!/^[a-f0-9]{32}$/i.test(access?.accountId ?? "") || !access?.headers) {
    throw new Error("[Goribu] R2 management needs the authenticated Cloudflare account. Run `goribu check` again after selecting an account with CLOUDFLARE_ACCOUNT_ID.");
  }
  const base = `https://api.cloudflare.com/client/v4/accounts/${access.accountId}`;

  async function request(path, { method = "GET", jurisdiction, body, missingCode } = {}) {
    let response, payload;
    try {
      response = await fetchImpl(base + path, {
        method, redirect: "error",
        headers: { ...access.headers, ...(jurisdiction === undefined ? {} : { "cf-r2-jurisdiction": jurisdiction }),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      payload = await response.json();
    } catch {
      throw new Error("[Goribu] Could not read a Cloudflare R2 management response. Check connectivity and retry `goribu check` before deploying. No bucket or object is deleted on failure.");
    }
    // A generic 404 can hide an authorization or routing problem. Only the
    // documented resource-missing code permits a first-deploy/create plan.
    if (response.status === 404 && payload?.success === false && missingCode !== undefined &&
        Array.isArray(payload.errors) && payload.errors.length === 1 && payload.errors[0]?.code === missingCode) return null;
    if (!response.ok || payload?.success !== true || !Object.hasOwn(payload, "result")) {
      throw new Error(`[Goribu] Cloudflare rejected R2 management (${method}, HTTP ${response.status}). Confirm account access, R2 permissions, and Workers Scripts Read permission. ${CLOUDFLARE_AUTH_HELP}Then rerun \`goribu check\` before deploying. Existing buckets and objects are preserved.`);
    }
    return payload.result;
  }

  return Object.freeze({
    async deployedBindings(workerName) {
      const settings = await request(`/workers/scripts/${encodeURIComponent(workerName)}/settings`, { missingCode: 10007 });
      if (settings === null) return [];
      if (!Array.isArray(settings?.bindings)) throw invalidMetadata("Worker bindings");
      const bindings = [];
      const seen = new Set();
      for (const binding of settings.bindings) {
        // Read only managed R2 metadata. Never inspect secret/variable values.
        if (binding?.name !== "R2" && binding?.name !== "R2_PRIVATE") continue;
        if (typeof binding.type !== "string" || !/^[a-z][a-z0-9_]*$/.test(binding.type)) throw invalidMetadata("managed Worker binding type");
        if (seen.has(binding.name)) throw invalidMetadata("managed Worker R2 bindings");
        seen.add(binding.name);
        if (binding.type === "secret_text" || binding.type === "secret_key") {
          throw new Error(`[Goribu] The deployed Worker has a ${binding.type} binding named ${binding.name}, which Goribu reserves for a managed R2 bucket. Wrangler preserves deployed secrets. Remove or rename ${binding.name} in .env.production if present, then run \`CLOUDFLARE_ACCOUNT_ID=${access.accountId} wrangler secret delete ${binding.name} --name ${workerName}\` and retry \`goribu deploy\`. Goribu does not read or delete the secret itself.`);
        }
        if (binding.type !== "r2_bucket") {
          bindings.push(Object.freeze({ binding: binding.name, type: binding.type }));
          continue;
        }
        if (!BUCKET_NAME.test(binding.bucket_name ?? "")) {
          throw invalidMetadata("managed Worker R2 bindings");
        }
        const jurisdiction = normalizeJurisdiction(binding.jurisdiction);
        bindings.push(Object.freeze({ binding: binding.name, type: binding.type, name: binding.bucket_name, jurisdiction }));
      }
      return Object.freeze(bindings);
    },
    async bucket(name, jurisdiction) {
      const path = `/r2/buckets/${encodeURIComponent(name)}`;
      const bucket = await request(path, { jurisdiction, missingCode: 10006 });
      if (bucket === null) return null;
      validateBucket(bucket, name, jurisdiction);
      const managed = await request(`${path}/domains/managed`, { jurisdiction });
      const custom = await request(`${path}/domains/custom`, { jurisdiction });
      if (typeof managed?.enabled !== "boolean" || !Array.isArray(custom?.domains)) throw invalidMetadata("bucket public access");
      const domains = custom.domains.map((domain) => {
        if (typeof domain?.enabled !== "boolean" || typeof domain.domain !== "string" ||
            !/^[a-z0-9.-]+$/i.test(domain.domain) || !domain.domain.includes(".")) throw invalidMetadata("bucket custom domains");
        return Object.freeze({ domain: domain.domain.toLowerCase(), enabled: domain.enabled });
      });
      return Object.freeze({ name, jurisdiction, devUrlEnabled: managed.enabled, domains: Object.freeze(domains) });
    },
    async createBucket(name, jurisdiction) {
      const result = await request("/r2/buckets", { method: "POST", jurisdiction, body: { name } });
      validateBucket(result, name, jurisdiction);
    },
  });
}

function validateBucket(bucket, name, jurisdiction) {
  if (!bucket || bucket.name !== name || !BUCKET_NAME.test(name) ||
      (bucket.jurisdiction !== undefined && normalizeJurisdiction(bucket.jurisdiction) !== jurisdiction)) {
    throw invalidMetadata("bucket identity or jurisdiction");
  }
}

function normalizeJurisdiction(value = "default") {
  if (!JURISDICTIONS.has(value)) throw invalidMetadata("bucket jurisdiction");
  return value;
}

function invalidMetadata(detail) {
  return new Error(`[Goribu] Cloudflare returned invalid ${detail}. Update Goribu and rerun \`goribu check\`; management cannot continue until the R2 state can be verified.`);
}
