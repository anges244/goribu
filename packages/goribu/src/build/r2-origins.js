/** Discover hostnames, including the generated config's first-deploy target. */
export async function discoverR2Origins({ request, accountId, workerName, workerExists }) {
  const origins = new Set(), warnings = [];
  const subdomain = workerExists ? await request(`/workers/scripts/${encodeURIComponent(workerName)}/subdomain`) : { enabled: true };
  if (typeof subdomain?.enabled !== "boolean") throw invalidOrigins();
  if (subdomain.enabled) {
    // Wrangler's generated no-route config enables workers.dev on first deploy.
    // Only its specific missing-subdomain response permits an empty origin plan.
    const account = await request("/workers/subdomain", { missingCode: 10007 });
    if (account === null || account?.subdomain === "") {
      warnings.push("The account has no workers.dev subdomain. Register one in Cloudflare Workers & Pages before retrying `goribu deploy`; Goribu does not register it automatically.");
    } else {
      if (typeof account?.subdomain !== "string" || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(account.subdomain)) throw invalidOrigins();
      origins.add(`https://${hostname(`${workerName}.${account.subdomain}.workers.dev`)}`);
    }
  }
  if (!workerExists) return { origins: [...origins], warnings, expectedAfterFirstDeploy: origins.size > 0 };
  const query = new URLSearchParams({ service: workerName, environment: "production" });
  const domains = await listAll(request, `/workers/domains?${query}`);
  for (const domain of domains) {
    if (domain?.service !== workerName || domain.environment !== "production") throw invalidOrigins();
    origins.add(`https://${hostname(domain.hostname)}`);
  }
  // Routes are zone-scoped. Inspect every accessible zone in the selected
  // account; never silently accept a partial or ambiguous inventory.
  const zones = await listAll(request, `/zones?${new URLSearchParams({ "account.id": accountId })}`, { accountScoped: false });
  const seen = new Set();
  for (const zone of zones) {
    if (!/^[a-f0-9]{32}$/i.test(zone?.id ?? "") || zone.account?.id !== accountId || seen.has(zone.id)) throw invalidOrigins();
    seen.add(zone.id);
    const zoneName = hostname(zone.name);
    const routes = await listAll(request, `/zones/${zone.id}/workers/routes`, { accountScoped: false });
    for (const route of routes) {
      if (!route || (route.script !== undefined && typeof route.script !== "string")) throw invalidOrigins();
      if (route.script !== workerName) continue;
      if (typeof route.pattern !== "string") throw invalidOrigins();
      const match = /^(?:(https?):\/\/)?([^/]+)(?:\/[^\s]*)?$/.exec(route.pattern);
      if (!match) throw invalidOrigins();
      if (match[2].includes("*")) {
        warnings.push(`Skipped wildcard-host Worker route ${JSON.stringify(route.pattern)} for upload CORS. Add an exact-host route or Worker custom domain, then redeploy for direct uploads on that hostname.`);
        continue;
      }
      const host = hostname(match[2]);
      if (host !== zoneName && !host.endsWith(`.${zoneName}`)) throw invalidOrigins();
      for (const scheme of match[1] ? [match[1]] : ["http", "https"]) origins.add(`${scheme}://${host}`);
    }
  }
  return { origins: [...origins].sort(), warnings };
}

async function listAll(request, path, options = {}) {
  const url = new URL(path, "https://api.cloudflare.com");
  url.searchParams.set("per_page", "50");
  const results = [], seenItems = new Set();
  let totalPages, totalCount;
  for (let current = 1; ; current++) {
    url.searchParams.set("page", String(current));
    const page = await request(url.pathname + url.search, { ...options, envelope: true });
    if (!Array.isArray(page?.result)) throw invalidOrigins();
    const info = page.result_info;
    if (info !== undefined && (!info || typeof info !== "object" || Array.isArray(info))) throw invalidOrigins();
    for (const key of ["page", "per_page", "count", "total_count", "total_pages"]) {
      if (info?.[key] !== undefined && (!Number.isSafeInteger(info[key]) || info[key] < 0)) throw invalidOrigins();
    }
    if ((info?.page !== undefined && info.page !== current) ||
        (info?.per_page !== undefined && info.per_page < 1) ||
        (info?.count !== undefined && info.count !== page.result.length)) throw invalidOrigins();
    const pages = info?.total_pages ?? (info?.total_count !== undefined
      ? Math.ceil(info.total_count / (info.per_page ?? 50)) : 1);
    if (pages === 0 && page.result.length > 0) throw invalidOrigins();
    if (current === 1) { totalPages = Math.max(1, pages); totalCount = info?.total_count; }
    else if (Math.max(1, pages) !== totalPages || info?.total_count !== totalCount) throw invalidOrigins();
    if (page.result.length === 0 && (current < totalPages || current > 1)) throw invalidOrigins();
    for (const item of page.result) {
      const identity = typeof item?.id === "string" ? `id:${item.id}` : JSON.stringify(item);
      if (seenItems.has(identity)) throw invalidOrigins();
      seenItems.add(identity);
    }
    results.push(...page.result);
    if (current >= totalPages) break;
  }
  if (totalCount !== undefined && totalCount !== results.length) throw invalidOrigins();
  return results;
}

function hostname(value) {
  if (typeof value !== "string" || value.length > 253 || !value.includes(".") ||
      !value.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) throw invalidOrigins();
  return value.toLowerCase();
}

function invalidOrigins() {
  return new Error("[Goribu] Could not verify a complete inventory of application origins for R2 uploads. Check Worker custom domains and routes, and grant Workers Scripts Read, Zone Read and Workers Routes Read for the selected account's zones. Retry `goribu check` if inventory changed during pagination; if results remain invalid, update Goribu. Upload CORS cannot be planned from a partial inventory.");
}
