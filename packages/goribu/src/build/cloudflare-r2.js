import { CLOUDFLARE_AUTH_HELP } from "./wrangler-diagnostics.js";
import { isDeepStrictEqual } from "node:util";
import { mergeR2UploadCors, validateR2CorsRules } from "./r2-cors.js";
import { discoverR2Origins } from "./r2-origins.js";

const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const JURISDICTIONS = new Set(["default", "eu", "us", "fedramp", "fedramp-high"]);

/** Metadata reads and managed bucket settings. No object/deletion API. */
export function createR2ManagementClient({ access, fetch: fetchImpl = globalThis.fetch }) {
  if (!/^[a-f0-9]{32}$/i.test(access?.accountId ?? "") || !access?.headers) {
    throw new Error("[Goribu] R2 management needs the authenticated Cloudflare account. Run `goribu check` again after selecting an account with CLOUDFLARE_ACCOUNT_ID.");
  }
  const base = "https://api.cloudflare.com/client/v4";

  async function request(path, { method = "GET", jurisdiction, body, missingCode, accountScoped = true, envelope = false } = {}) {
    let response, payload;
    try {
      response = await fetchImpl(base + (accountScoped ? `/accounts/${access.accountId}` : "") + path, {
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
      const domainHelp = method === "POST" && path.endsWith("/domains/custom") ? "Check whether the hostname already belongs to another bucket or DNS record; Goribu does not reassign it. " : "";
      throw new Error(`[Goribu] Cloudflare rejected R2 management (${method}, HTTP ${response.status}). Confirm account access, R2 permissions, Workers Scripts Read, Zone Read for domains, and Workers Routes Read on the account's zones for direct uploads. ${domainHelp}${CLOUDFLARE_AUTH_HELP}Then rerun \`goribu check\` before deploying. Existing buckets and objects are preserved.`);
    }
    return envelope ? payload : payload.result;
  }

  async function readCors(path, jurisdiction) {
    // Live R2 returns 404/10059 when the bucket has no CORS configuration.
    // Missing buckets, denied access and unrelated 404s must still block writes.
    const response = await request(path, { jurisdiction, missingCode: 10059, envelope: true });
    return response === null ? [] : validateR2CorsRules(response.result?.rules);
  }

  return Object.freeze({
    origins(workerName, workerExists) {
      return discoverR2Origins({ request, accountId: access.accountId, workerName, workerExists });
    },
    async worker(workerName) {
      const settings = await request(`/workers/scripts/${encodeURIComponent(workerName)}/settings`, { missingCode: 10007 });
      if (settings === null) return Object.freeze({ exists: false, bindings: Object.freeze([]) });
      if (!Array.isArray(settings?.bindings)) throw invalidMetadata("Worker bindings");
      const bindings = [];
      const seen = new Set();
      for (const binding of settings.bindings) {
        // Read only managed R2 metadata. Never inspect secret/variable values.
        if (binding?.name === "GORIBU_SECRET" && binding.type !== "secret_text") {
          throw new Error("[Goribu] The deployed GORIBU_SECRET binding is not a text secret. Remove or rename it in Cloudflare Worker Settings > Variables and Secrets and in the app configuration, then retry `goribu deploy`. Goribu requires a text secret and never reads its value.");
        }
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
      return Object.freeze({ exists: true, bindings: Object.freeze(bindings) });
    },
    async zone(domain) {
      const labels = domain.split(".");
      for (let index = 0; index < labels.length - 1; index++) {
        const name = labels.slice(index).join(".");
        const query = new URLSearchParams({ name, "account.id": access.accountId, per_page: "50" });
        const page = await request(`/zones?${query}`, { accountScoped: false, envelope: true });
        if (!Array.isArray(page.result) || page.result.length > 1 ||
            (page.result_info?.total_pages ?? 1) > 1 || (page.result_info?.total_count ?? page.result.length) !== page.result.length) throw invalidMetadata("zone lookup");
        if (page.result.length === 0) continue;
        const zone = page.result[0];
        if (!/^[a-f0-9]{32}$/i.test(zone?.id ?? "") || zone.name !== name || zone.account?.id !== access.accountId) throw invalidMetadata("zone identity or account");
        if (zone.status !== "active") throw new Error(`[Goribu] The Cloudflare zone ${name} is not active. Activate it in the selected account before connecting ${domain}, then rerun \`goribu check\`.`);
        return Object.freeze({ id: zone.id, name });
      }
      throw new Error(`[Goribu] No accessible zone for ${domain} exists in the selected R2 account. Add or move the zone to this account and grant Zone Read permission, or choose a domain in this account, then rerun \`goribu check\`.`);
    },
    async bucket(name, jurisdiction) {
      const path = `/r2/buckets/${encodeURIComponent(name)}`;
      const bucket = await request(path, { jurisdiction, missingCode: 10006 });
      if (bucket === null) return null;
      validateBucket(bucket, name, jurisdiction);
      const managed = await request(`${path}/domains/managed`, { jurisdiction });
      const custom = await request(`${path}/domains/custom`, { jurisdiction });
      if (typeof managed?.enabled !== "boolean" || !Array.isArray(custom?.domains)) throw invalidMetadata("bucket public access");
      const seenDomains = new Set();
      const domains = custom.domains.map((domain) => {
        if (typeof domain?.enabled !== "boolean" || typeof domain.domain !== "string" ||
            !/^[a-z0-9.-]+$/i.test(domain.domain) || !domain.domain.includes(".")) throw invalidMetadata("bucket custom domains");
        const hostname = domain.domain.toLowerCase();
        if (seenDomains.has(hostname)) throw invalidMetadata("duplicate bucket custom domains");
        seenDomains.add(hostname);
        return Object.freeze({ domain: hostname, enabled: domain.enabled });
      });
      return Object.freeze({ name, jurisdiction, devUrlEnabled: managed.enabled, domains: Object.freeze(domains) });
    },
    async createBucket(name, jurisdiction) {
      const result = await request("/r2/buckets", { method: "POST", jurisdiction, body: { name } });
      validateBucket(result, name, jurisdiction);
    },
    async attachDomain(name, jurisdiction, domain, zoneId) {
      const result = await request(`/r2/buckets/${encodeURIComponent(name)}/domains/custom`, {
        method: "POST", jurisdiction, body: { domain, zoneId, enabled: true, minTLS: "1.2" },
      });
      if (result?.domain !== domain || result.enabled !== true || result.zoneId !== zoneId) throw invalidMetadata("attached custom domain");
    },
    async cors(name, jurisdiction) {
      return readCors(`/r2/buckets/${encodeURIComponent(name)}/cors`, jurisdiction);
    },
    async upsertUploadCors(name, jurisdiction, origins) {
      const path = `/r2/buckets/${encodeURIComponent(name)}/cors`;
      // Refresh immediately before merging: a prior check's snapshot may be old.
      const current = await readCors(path, jurisdiction);
      const merged = mergeR2UploadCors(current, origins);
      if (!merged.changed) return false;
      await request(path, { method: "PUT", jurisdiction, body: { rules: merged.rules } });
      const confirmed = await readCors(path, jurisdiction);
      if (!isDeepStrictEqual(confirmed, merged.rules)) {
        throw new Error("[Goribu] The R2 CORS update could not be confirmed. Inspect the bucket's CORS settings for concurrent changes, then rerun `goribu check` before deploying. Goribu will not retry by replacing rules from an old snapshot.");
      }
      return true;
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
