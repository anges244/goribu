import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestHarness } from "wrangler";
import { expect, it } from "vitest";
import { copyTestApp } from "./support/copy-test-app.js";

// Real `goribu build` runs of the fixture, observed through Cloudflare's local
// asset router. The response-header marker appears only when the Worker runs.
const fixture = fileURLToPath(new URL("../../../fixtures/basic-app", import.meta.url));
const cli = fileURLToPath(new URL("../bin/goribu.js", import.meta.url));

function buildFixture(prefix, files = {}) {
  const root = copyTestApp(fixture, prefix);
  for (const [path, source] of Object.entries({
    "goribu.config.js": `import { defineConfig } from "goribu/server";
export default defineConfig({ name: "goribu-basic-app", compatibilityDate: "2026-08-31",
  kv: { name: "goribu-basic-app-kv" }, responseHeaders: () => ({ "x-worker-executed": "yes" }) });`,
    ...files,
  })) writeFileSync(join(root, path), source);
  const result = spawnSync(process.execPath, [cli, "build"], { cwd: root, encoding: "utf8", timeout: 100000 });
  return { root, status: result.status, output: `${result.stdout ?? ""}\n${result.stderr ?? ""}` };
}

it("answers unknown URLs of a built application with its static _404 page without invoking the Worker", async () => {
  const build = buildFixture("goribu-worker-routing-build-");
  let harness;
  try {
    expect(build.status, build.output).toBe(0);
    harness = createTestHarness({ workers: [{ configPath: join(build.root, ".goribu/dist/goribu_basic_app/wrangler.json") }] });
    const { url } = await harness.listen();

    for (const [path, status, worker, text] of [
      ["/wp-login.php", 404, false, "custom _404 page"],
      ["/hello/.env", 404, false, "custom _404 page"],
      ["/about", 200, false, "<h1>About</h1>"],
      // The miss page's own URL is still a miss, as in development.
      ["/404", 404, true, "custom _404 page"],
      ["/hello", 200, true, "hasServerToken"],
      // A dynamic pattern still admits deeper URLs; the Worker answers them.
      ["/posts/1/wp-login.php", 404, true, "custom _404 page"],
    ]) {
      const response = await fetch(new URL(path, url), { redirect: "manual" });
      expect(response.status, path).toBe(status);
      expect(response.headers.get("x-worker-executed"), path).toBe(worker ? "yes" : null);
      expect(await response.text(), path).toContain(text);
    }
    const head = await fetch(new URL("/wp-login.php", url), { method: "HEAD" });
    expect(head.status).toBe(404);
    expect(head.headers.get("x-worker-executed")).toBeNull();
    expect(await head.text()).toBe("");
  } finally {
    await harness?.close();
    rmSync(build.root, { recursive: true, force: true });
  }
}, 120000);

it("fails the build when .assetsignore keeps Static Assets from serving the miss page", () => {
  const build = buildFixture("goribu-worker-routing-ignored-", { "public/.assetsignore": "404.html\n" });
  try {
    expect(build.status).toBe(1);
    expect(build.output).toContain("Static Assets does not serve the generated 404.html for unknown URLs");
  } finally {
    rmSync(build.root, { recursive: true, force: true });
  }
}, 120000);
