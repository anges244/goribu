/** Resolve the most specific zone in the authenticated deployment account. */
export async function findCloudflareZone({ request, accountId, domain, invalidMetadata, accountLabel = "account" }) {
  const labels = domain.split(".");
  for (let index = 0; index < labels.length - 1; index++) {
    const name = labels.slice(index).join(".");
    const query = new URLSearchParams({ name, "account.id": accountId, per_page: "50" });
    const page = await request(`/zones?${query}`, { accountScoped: false, envelope: true });
    const info = page?.result_info;
    if (!Array.isArray(page?.result) || page.result.length > 1 ||
        (info !== undefined && (!info || typeof info !== "object" || Array.isArray(info))) ||
        ["page", "per_page", "count", "total_pages", "total_count"].some((key) =>
          info?.[key] !== undefined && (!Number.isSafeInteger(info[key]) || info[key] < 0)) ||
        (info?.page !== undefined && info.page !== 1) ||
        (info?.per_page !== undefined && info.per_page < 1) ||
        (info?.count !== undefined && info.count !== page.result.length) ||
        (info?.total_pages ?? 1) > 1 || (info?.total_count ?? page.result.length) !== page.result.length ||
        (info?.total_pages === 0 && page.result.length > 0)) throw invalidMetadata("zone lookup");
    if (page.result.length === 0) continue;
    const zone = page.result[0];
    if (!/^[a-f0-9]{32}$/i.test(zone?.id ?? "") || zone.name !== name || zone.account?.id !== accountId) throw invalidMetadata("zone identity or account");
    if (zone.status !== "active") throw new Error(`[Goribu] The Cloudflare zone ${name} is not active. Activate it in the selected account before connecting ${domain}, then rerun \`goribu check\`.`);
    return Object.freeze({ id: zone.id, name });
  }
  throw new Error(`[Goribu] No accessible zone for ${domain} exists in the selected ${accountLabel}. Add or move the zone to this account and grant Zone Read permission, or choose a domain in this account, then rerun \`goribu check\`.`);
}
