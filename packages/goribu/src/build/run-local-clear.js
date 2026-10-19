import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadApplicationConfig } from "./load-application-config.js";

const CONFIG_PATH = join(".goribu", "local-clear.wrangler.json");
// The same store `goribu dev`, `goribu migrate` and `goribu d1` use.
const LOCAL_STATE = join(".wrangler", "state", "v3");
const PAGE_SIZE = 1000;

/**
 * Delete the local R2 objects or KV keys that `goribu dev` reads and writes.
 *
 * Wrangler's local bindings do the work, so Goribu depends on the R2 and KV
 * APIs rather than Miniflare's storage files, and a running dev server sees the
 * result immediately. Remote bindings and env files are disabled: this never
 * reaches Cloudflare.
 *
 * @param {{ projectRoot: string, target: "r2" | "kv", prefix?: string, loadConfig?: Function, getPlatformProxy?: Function, stdout?: { write(text: string): void } }} options
 */
export async function runLocalClear(options) {
  const { projectRoot, target } = options;
  const prefix = options.prefix ?? "";
  const root = resolve(projectRoot);
  const appConfig = await (options.loadConfig ?? loadApplicationConfig)({ projectRoot: root });
  const stdout = options.stdout ?? process.stdout;
  const stores = target === "r2" ? r2Stores(appConfig) : kvStores(appConfig);

  const configPath = join(root, CONFIG_PATH);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify({
    name: appConfig.name,
    compatibility_date: appConfig.compatibilityDate,
    ...(target === "r2"
      ? { r2_buckets: stores.map(({ binding, name }) => ({ binding, bucket_name: name, ...jurisdiction(appConfig) })) }
      : { kv_namespaces: stores.map(({ binding, name }) => ({ binding, preview_id: name })) }),
  }, null, 2)}\n`, "utf8");

  const getPlatformProxy = options.getPlatformProxy ?? (await import("wrangler")).getPlatformProxy;
  const proxy = await getPlatformProxy({
    configPath,
    persist: { path: join(root, LOCAL_STATE) },
    envFiles: [],
    remoteBindings: false,
  });
  try {
    const under = prefix === "" ? "" : ` under ${JSON.stringify(prefix)}`;
    for (const { binding, name } of stores) {
      if (target === "r2") {
        const count = await clearBucket(proxy.env[binding], prefix);
        stdout.write(`Deleted ${count} ${count === 1 ? "object" : "objects"}${under} from local R2 bucket ${name}.\n`);
      } else {
        const count = await clearNamespace(proxy.env[binding], prefix);
        stdout.write(`Deleted ${count} ${count === 1 ? "key" : "keys"}${under} from local KV namespace ${name}.\n`);
      }
    }
  } finally {
    await proxy.dispose();
  }
}

function r2Stores(appConfig) {
  if (appConfig.r2 === undefined) {
    throw new Error(
      "[Goribu] `goribu local:clear r2` found no `r2` bucket in goribu.config.js, so there is no local R2 data to clear.",
    );
  }
  return [
    { binding: "R2", name: appConfig.r2.name },
    ...(appConfig.r2.private === undefined ? [] : [{ binding: "R2_PRIVATE", name: appConfig.r2.private.name }]),
  ];
}

function kvStores(appConfig) {
  if (appConfig.kv === undefined) {
    throw new Error(
      "[Goribu] `goribu local:clear kv` found no `kv` namespace in goribu.config.js, so there is no local KV data to clear.",
    );
  }
  return [{ binding: "KV", name: appConfig.kv.name }];
}

function jurisdiction(appConfig) {
  return appConfig.r2.jurisdiction === undefined ? {} : { jurisdiction: appConfig.r2.jurisdiction };
}

// Each pass lists from the start, because deleting invalidates a cursor.
async function clearBucket(bucket, prefix) {
  let count = 0;
  for (;;) {
    const { objects } = await bucket.list({ prefix, limit: PAGE_SIZE });
    if (objects.length === 0) return count;
    await bucket.delete(objects.map((object) => object.key));
    count += objects.length;
  }
}

async function clearNamespace(namespace, prefix) {
  let count = 0;
  for (;;) {
    const { keys } = await namespace.list({ prefix, limit: PAGE_SIZE });
    if (keys.length === 0) return count;
    for (const { name } of keys) await namespace.delete(name);
    count += keys.length;
  }
}
