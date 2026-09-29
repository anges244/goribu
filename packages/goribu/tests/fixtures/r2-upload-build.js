import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const builtAt = "2026-09-29T12:00:00.000Z";
export function writeUploadBuild(root, appConfig, fields = {}) {
  mkdirSync(join(root, ".wrangler/deploy"), { recursive: true });
  mkdirSync(join(root, "output"), { recursive: true });
  writeFileSync(join(root, ".wrangler/deploy/config.json"), JSON.stringify({ configPath: "../../output/wrangler.json" }));
  writeFileSync(join(root, "output/wrangler.json"), JSON.stringify({ name: appConfig.name }));
  const path = join(root, "output/r2-uploads.json");
  writeFileSync(path, JSON.stringify({ version: 1, builtAt,
    routes: Object.keys(fields).length ? [{ id: "src/routes/upload.jsx", pattern: "/upload", fields }] : [] }));
  return path;
}
