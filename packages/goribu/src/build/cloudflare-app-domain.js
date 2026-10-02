import { findCloudflareZone } from "./cloudflare-zone.js";
import { CLOUDFLARE_AUTH_HELP } from "./wrangler-diagnostics.js";
import { HOST_LABEL } from "../runtime/hostname-config.js";

const ID = /^[a-f0-9]{32}$/i;

/** Ownership reads, native conflict previews and non-overwriting attachment. */
export function createAppDomainManagementClient({ access, fetch: fetchImpl = globalThis.fetch }) {
  if (!ID.test(access?.accountId ?? "") || !access?.headers) {
    throw new Error("[Goribu] App domain management needs the authenticated Cloudflare account. Select an account with CLOUDFLARE_ACCOUNT_ID and rerun `goribu check`.");
  }
  async function request(path, { method = "GET", body, accountScoped = true, envelope = false, missingCode } = {}) {
    let response, payload;
    try {
      response = await fetchImpl(`https://api.cloudflare.com/client/v4${accountScoped ? `/accounts/${access.accountId}` : ""}${path}`, {
        method, redirect: "error",
        headers: { ...access.headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      payload = await response.json();
    } catch {
      throw new Error("[Goribu] Could not read a Cloudflare app domain response. Check connectivity, inspect the Worker's Domains & Routes, and rerun `goribu check` before deploying. An interrupted attachment may have succeeded; Goribu does not disconnect domains on failure.");
    }
    // Cloudflare cannot preview domains for a Worker that has not been created.
    // Only its specific service-missing response permits a first-deploy plan.
    if (response.status === 404 && payload?.success === false && missingCode !== undefined &&
        Array.isArray(payload.errors) && payload.errors.length === 1 && payload.errors[0]?.code === missingCode) return null;
    if (!response.ok || payload?.success !== true || !Object.hasOwn(payload, "result")) {
      throw new Error(`[Goribu] Cloudflare rejected app domain management (${method}, HTTP ${response.status}). Confirm Workers Scripts Write and Zone Read permissions in the selected account. Check for an existing Worker, R2 domain or DNS record at the hostname; Goribu does not reassign it. ${CLOUDFLARE_AUTH_HELP}Then rerun \`goribu check\` before deploying.`);
    }
    return envelope ? payload : payload.result;
  }

  return Object.freeze({
    zone(domain) {
      return findCloudflareZone({ request, accountId: access.accountId, domain, invalidMetadata });
    },
    async domains() {
      // No service/environment filter: another Worker's claim must be visible.
      const domains = (await listAll(request, "/workers/domains")).map(validateDomain);
      if (new Set(domains.map((domain) => domain.hostname)).size !== domains.length) throw invalidMetadata("duplicate Worker hostnames");
      return domains;
    },
    async previewDomain({ name, worker, zoneId }) {
      // This POST is a read-only changeset, also used by Wrangler before its
      // confirmation prompt. It needs no separate DNS-record permission.
      const response = await request(`/workers/scripts/${encodeURIComponent(worker)}/domains/changeset?replace_state=false`, {
        method: "POST", body: [{ hostname: name, zone_id: zoneId }], missingCode: 10090, envelope: true,
      });
      if (response === null) return null;
      const preview = response.result;
      if (!["added", "updated", "removed", "conflicting"].every((key) => Array.isArray(preview?.[key])) || preview.removed.length > 0) throw invalidMetadata("domain conflict preview");
      if (preview.conflicting.length > 0) {
        throw new Error(`[Goribu] App domain ${name} has a DNS or certificate conflict reported by Cloudflare. Choose an unused hostname, or inspect its DNS records and any R2 custom-domain attachment in Cloudflare and remove the conflict yourself only if intended, then rerun \`goribu check\`. Goribu does not replace existing DNS records.`);
      }
      if (preview.updated.some((domain) => domain?.modified === true)) {
        throw new Error(`[Goribu] App domain ${name} is already assigned in Cloudflare. Inspect the Worker's Domains & Routes, choose an unused hostname or deliberately disconnect the existing attachment, then rerun \`goribu check\`. Goribu does not reassign occupied hostnames.`);
      }
      const proposed = [...preview.added, ...preview.updated];
      if (proposed.length !== 1 || proposed[0]?.hostname !== name || proposed[0]?.service !== worker || proposed[0]?.zone_id !== zoneId ||
          !["", "production"].includes(proposed[0]?.environment) || preview.updated.some((domain) => domain?.modified !== false)) throw invalidMetadata("domain conflict preview");
      return true;
    },
    async attachDomain({ name, worker, zoneId }) {
      // Use Wrangler's native endpoint, but keep all replacement flags off:
      // preserve other domains and let Cloudflare reject conflicts at write time.
      await request(`/workers/scripts/${encodeURIComponent(worker)}/domains/records`, {
        method: "PUT", body: {
          override_scope: false, override_existing_origin: false, override_existing_dns_record: false,
          origins: [{ hostname: name, zone_id: zoneId }],
        },
      });
    },
  });
}

async function listAll(request, path) {
  const url = new URL(path, "https://api.cloudflare.com");
  url.searchParams.set("per_page", "50");
  const results = [], seen = new Set();
  let totalPages, totalCount;
  for (let current = 1; ; current++) {
    url.searchParams.set("page", String(current));
    const page = await request(url.pathname + url.search, { envelope: true });
    if (!Array.isArray(page?.result)) throw invalidMetadata("domain inventory");
    const info = page.result_info;
    if (info !== undefined && (!info || typeof info !== "object" || Array.isArray(info))) throw invalidMetadata("inventory pagination");
    for (const key of ["page", "per_page", "count", "total_count", "total_pages"]) {
      if (info?.[key] !== undefined && (!Number.isSafeInteger(info[key]) || info[key] < 0)) throw invalidMetadata("inventory pagination");
    }
    if ((info?.page !== undefined && info.page !== current) ||
        (info?.per_page !== undefined && (info.per_page < 1 || page.result.length > info.per_page)) ||
        (info?.count !== undefined && info.count !== page.result.length)) throw invalidMetadata("inventory pagination");
    // APIs may omit result_info for an unpaginated array. When pagination is
    // advertised, require a total; a partial page is not an ownership proof.
    if (info !== undefined && info.total_pages === undefined && info.total_count === undefined) throw invalidMetadata("incomplete inventory pagination");
    const pages = info?.total_pages ?? (info?.total_count !== undefined ? Math.ceil(info.total_count / (info.per_page ?? 50)) : 1);
    if (pages === 0 && page.result.length > 0) throw invalidMetadata("inventory pagination");
    if (current === 1) { totalPages = Math.max(1, pages); totalCount = info?.total_count; }
    else if (Math.max(1, pages) !== totalPages || info?.total_count !== totalCount) throw invalidMetadata("changed inventory pagination");
    if (page.result.length === 0 && (current < totalPages || current > 1)) throw invalidMetadata("missing inventory page");
    for (const item of page.result) {
      if (typeof item?.id !== "string" || !/^[a-z0-9-]{1,128}$/i.test(item.id) || seen.has(item.id)) throw invalidMetadata("duplicate or invalid inventory identity");
      seen.add(item.id);
    }
    results.push(...page.result);
    if (current >= totalPages) break;
  }
  if (totalCount !== undefined && totalCount !== results.length) throw invalidMetadata("incomplete inventory");
  return results;
}

function validateDomain(domain) {
  const name = hostname(domain?.hostname);
  if (typeof domain?.service !== "string" || !/^[a-z0-9_-]{1,255}$/i.test(domain.service) ||
      typeof domain.environment !== "string" || !/^[a-z0-9_-]{1,255}$/i.test(domain.environment) || !ID.test(domain.zone_id ?? "")) throw invalidMetadata("Worker domain ownership");
  return Object.freeze({ hostname: name, service: domain.service, environment: domain.environment, zoneId: domain.zone_id });
}

function hostname(value) {
  if (typeof value !== "string" || value.length > 253 || !value.includes(".") ||
      !value.split(".").every((label) => HOST_LABEL.test(label))) throw invalidMetadata("domain hostname");
  return value.toLowerCase();
}

function invalidMetadata(detail) {
  return new Error(`[Goribu] Cloudflare returned invalid or incomplete ${detail}. Retry \`goribu check\` if the domain inventory changed; if it persists, update Goribu and inspect Cloudflare Domains & Routes and DNS settings. App domain management cannot continue until ownership can be verified.`);
}
