import { lstatSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readDeployConfig } from "./update-deploy-config.js";
import { collectUploadPolicies } from "../r2/upload-policies.js";

/** Only generated metadata is read; no app modules or env files are loaded. */
export function readR2Uploads({ projectRoot, appConfig, required = false }) {
  const fail = () => new Error("[Goribu] Could not verify the build's R2 upload metadata. Run `goribu build` first, then retry. If the problem persists, update Goribu; no upload deployment plan can be inferred from invalid output.");
  const output = readDeployConfig({ projectRoot, fail, optional: !required });
  if (!output) return null;
  if (output.config.name !== appConfig.name) throw fail();
  const path = join(dirname(output.realConfig), "r2-uploads.json");
  let metadata, stat;
  try {
    stat = lstatSync(path);
    if (!stat.isFile()) throw fail();
    metadata = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (!required && error.code === "ENOENT") return null;
    throw fail();
  }
  if (metadata?.version !== 1 || !Array.isArray(metadata.routes)) throw fail();
  // Older inventories predate builtAt; their write time is the available label.
  const builtAt = metadata.builtAt ?? stat.mtime.toISOString();
  if (typeof builtAt !== "string" || !Number.isFinite(Date.parse(builtAt)) || new Date(builtAt).toISOString() !== builtAt) throw fail();
  const ids = new Set();
  const manifest = [], modules = new Map();
  for (const route of metadata.routes) {
    if (typeof route?.id !== "string" || !route.id || ids.has(route.id) ||
        typeof route.pattern !== "string" || !route.pattern.startsWith("/") ||
        !route.fields || typeof route.fields !== "object" || Array.isArray(route.fields)) throw fail();
    ids.add(route.id);
    for (const policy of Object.values(route.fields)) {
      if (!policy || typeof policy.private !== "boolean" || typeof policy.direct !== "boolean") throw fail();
    }
    manifest.push({ id: route.id, pattern: route.pattern, methods: ["POST"] });
    modules.set(route.id, { uploads: route.fields, POST() {} });
  }
  // Reuse policy validation without importing any application code or key function.
  try {
    const { summary } = collectUploadPolicies(manifest, modules, appConfig.r2);
    return { builtAt, routes: summary };
  } catch { throw fail(); }
}
