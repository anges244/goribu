import { isApplicationConfig } from "../runtime/application-config.js";
import { findDeclaredKVNamespace, listRemoteKVNamespaces, normalizeKVNamespaces } from "./inspect-kv.js";
import { getCloudflareAccess } from "./cloudflare-access.js";

/** Create or reuse the single declared namespace. Existing namespaces need no update. */
export async function provisionKV(options) {
  const { projectRoot, appConfig } = options ?? {};
  if (typeof projectRoot !== "string" || !projectRoot || !isApplicationConfig(appConfig)) {
    throw new TypeError("[Goribu] provisionKV requires projectRoot and the defineConfig() result from goribu.config.js.");
  }
  if (appConfig.kv === undefined) return null;
  const stdout = options?.stdout ?? process.stdout;
  if (typeof stdout?.write !== "function") {
    throw new TypeError("[Goribu] provisionKV requires a writable stdout stream; pass process.stdout.");
  }
  const inspectKV = options?.inspectKV ?? listRemoteKVNamespaces;
  const existing = findDeclaredKVNamespace({
    appConfig, remoteNamespaces: await inspectKV({ projectRoot }),
  });
  if (existing !== undefined) return existing;

  const access = await (options?.getAccess ?? getCloudflareAccess)({ projectRoot });
  const namespace = await (options?.createNamespace ?? createCloudflareKVNamespace)({
    access, title: appConfig.kv.name,
  });
  const [validated] = normalizeKVNamespaces([namespace]);
  if (validated.title !== appConfig.kv.name) {
    throw new Error("[Goribu] Cloudflare returned a different KV namespace after creation. Inspect the namespace in Cloudflare and rerun `goribu check` before deploying again.");
  }
  stdout.write(`✓ Created KV namespace ${validated.title}\n`);
  return validated;
}

export async function createCloudflareKVNamespace({ access, title, fetch: fetchImpl = globalThis.fetch }) {
  let response;
  try {
    response = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(access.accountId)}/storage/kv/namespaces`,
      {
        method: "POST",
        headers: { ...access.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      },
    );
  } catch (cause) {
    throw new Error("[Goribu] Could not reach Cloudflare while creating KV. Check the network and rerun `goribu check` before retrying `goribu deploy`.", { cause });
  }
  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new Error("[Goribu] Cloudflare returned an unreadable KV creation response. Rerun `goribu check` before retrying `goribu deploy`.", { cause });
  }
  if (!response.ok || payload?.success !== true) {
    throw new Error(
      `[Goribu] Cloudflare rejected KV creation with HTTP ${response.status}. Confirm Wrangler has Workers KV Storage Write permission and rerun \`goribu check\` before retrying \`goribu deploy\`.`,
    );
  }
  return payload.result;
}
