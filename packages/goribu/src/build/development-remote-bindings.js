import { getCloudflareAccess } from "./cloudflare-access.js";
import { listRemoteBindings } from "./wrangler-passthrough.js";

/**
 * Before goribu dev starts, give remote-only wrangler bindings such as AI the
 * same Cloudflare account that `goribu deploy` selects.
 *
 * Wrangler proxies those bindings to Cloudflare even in local development, so
 * dev needs credentials whenever one is declared. Resolving the account here
 * turns a missing login into an error naming the binding, and pins Wrangler's
 * proxy to that account through CLOUDFLARE_ACCOUNT_ID, as deploy pins its child.
 */
export async function prepareDevelopmentRemoteBindings({ projectRoot, appConfig, getAccess = getCloudflareAccess }) {
  const remote = listRemoteBindings(appConfig.wrangler);
  if (remote.length === 0) return;
  let access;
  try {
    access = await getAccess({ projectRoot, command: "goribu dev" });
  } catch (error) {
    // The access error's text is repeated here, so keep only what caused it.
    throw new Error(
      `[Goribu] The wrangler binding${remote.length === 1 ? "" : "s"} ${remote.join(", ")} run${remote.length === 1 ? "s" : ""} on Cloudflare even in goribu dev, so dev needs Cloudflare access. ` +
        String(error?.message ?? error).replace(/^\[Goribu\] /, ""),
      { cause: error?.cause },
    );
  }
  process.env.CLOUDFLARE_ACCOUNT_ID = access.accountId;
}
