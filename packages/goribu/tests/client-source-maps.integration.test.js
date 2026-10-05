import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const fixture = fileURLToPath(new URL("../../../fixtures/basic-app", import.meta.url));
const cli = fileURLToPath(new URL("../bin/goribu.js", import.meta.url));

it("excludes colocated POST source from published client maps without removing Worker sources", () => {
  const root = mkdtempSync(join(tmpdir(), "goribu-client-source-maps-"));
  const marker = "POST_HANDLER_SOURCE_MUST_NOT_BE_PUBLIC_2cc945";
  try {
    cpSync(join(fixture, "src"), join(root, "src"), { recursive: true });
    cpSync(join(fixture, "package.json"), join(root, "package.json"));
    symlinkSync(join(fixture, "node_modules"), join(root, "node_modules"), "dir");
    writeFileSync(join(root, "goribu.config.js"), 'import { defineConfig } from "goribu/server"; export default defineConfig({ name: "source-map-check", compatibilityDate: "2026-09-01" });');
    writeFileSync(join(root, "vite.config.js"), 'import { goribu } from "goribu/vite"; export default { plugins: [goribu()], build: { sourcemap: true } };');
    writeFileSync(join(root, "src/routes/source-check.jsx"), `
export function POST(req, res) { return res.text(${JSON.stringify(marker)}); }
export default function Page() { return <h1>Source map check</h1>; }
`);
    const built = spawnSync(process.execPath, [cli, "build"], {
      cwd: root, encoding: "utf8", timeout: 100000,
      env: { ...process.env, NODE_ENV: "production" },
    });
    expect(built.error).toBeUndefined();
    expect(built.status, built.stdout + built.stderr).toBe(0);
    const client = join(root, ".goribu/dist/client");
    let routeMap;
    for (const file of readdirSync(client, { recursive: true, withFileTypes: true })) {
      if (!file.isFile()) continue;
      const source = readFileSync(join(file.parentPath, file.name), "utf8");
      expect(source).not.toContain(marker);
      expect(source).not.toContain("NESTED_SERVER_SOURCE_MUST_NOT_REACH_BROWSER");
      if (file.name.endsWith(".map")) {
        const map = JSON.parse(source);
        if (map.sources.some((path) => path.endsWith("/source-check.jsx"))) routeMap = map;
      }
    }
    expect(routeMap).toBeDefined();
    expect(routeMap.mappings.length).toBeGreaterThan(0);
    expect(routeMap.sourcesContent?.some((source) => source != null) ?? false).toBe(false);
    const worker = join(root, ".goribu/dist/source_map_check");
    expect(readFileSync(join(worker, "index.js"), "utf8")).toContain(marker);
    const workerMap = JSON.parse(readFileSync(join(worker, "index.js.map"), "utf8"));
    expect(workerMap.sourcesContent.some((source) => source?.includes(marker))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 120000);
