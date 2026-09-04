import { spawn as nodeSpawn } from "node:child_process";
import { resolve } from "node:path";
import { resolveWranglerBin } from "./resolve-wrangler-bin.js";

/** Pinned Wrangler emits JSON and follows every page of the namespace inventory. */
export async function listRemoteKVNamespaces(options) {
  const projectRoot = options?.projectRoot;
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new TypeError("[Goribu] listRemoteKVNamespaces requires the application projectRoot.");
  }
  let output = "";
  try {
    const spawn = options?.spawn ?? nodeSpawn;
    const bin = (options?.resolveBin ?? resolveWranglerBin)();
    const child = spawn(process.execPath, [bin, "kv", "namespace", "list"], {
      cwd: resolve(projectRoot),
      stdio: ["ignore", "pipe", "inherit"],
    });
    await new Promise((resolvePromise, rejectPromise) => {
      child.on("error", rejectPromise);
      child.on("close", (code, signal) => {
        if (code === 0 && signal === null) resolvePromise();
        else rejectPromise(new Error(`Wrangler finished with ${signal ?? code}`));
      });
      child.stdout.on("data", (chunk) => { output += String(chunk); });
    });
  } catch (cause) {
    throw new Error(
      "[Goribu] Could not inspect KV namespaces through Wrangler. Check the Wrangler error, installed dependencies, authentication, and account selection, then rerun `goribu check`. No resources were changed by this inspection.",
      { cause },
    );
  }
  let namespaces;
  try {
    namespaces = JSON.parse(output);
  } catch (cause) {
    throw new Error(
      "[Goribu] Wrangler returned invalid KV namespace JSON. Update Wrangler and rerun `goribu check`. No resources were changed by this inspection.",
      { cause },
    );
  }
  return normalizeKVNamespaces(namespaces);
}

export function normalizeKVNamespaces(namespaces) {
  if (!Array.isArray(namespaces)) throw inventoryError();
  return Object.freeze(namespaces.map((namespace) => {
    if (
      typeof namespace?.title !== "string" || namespace.title.length === 0 ||
      typeof namespace?.id !== "string" || !/^[a-f0-9]{32}$/.test(namespace.id)
    ) throw inventoryError();
    return Object.freeze({ title: namespace.title, id: namespace.id });
  }));
}

export function findDeclaredKVNamespace({ appConfig, remoteNamespaces }) {
  if (appConfig.kv === undefined) return undefined;
  const matches = normalizeKVNamespaces(remoteNamespaces).filter(
    (namespace) => namespace.title === appConfig.kv.name,
  );
  if (matches.length > 1) {
    throw new Error(
      `[Goribu] Cloudflare returned more than one KV namespace named ${JSON.stringify(appConfig.kv.name)}. Resolve the duplicate resources in Cloudflare and rerun \`goribu check\`; Goribu cannot choose a binding safely.`,
    );
  }
  return matches[0];
}

function inventoryError() {
  return new Error(
    "[Goribu] Cloudflare returned an invalid KV namespace inventory. Update Wrangler and rerun `goribu check`; Goribu needs namespace titles and valid ids before it can plan or provision.",
  );
}
