import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createTestHarness } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sourceDir = fileURLToPath(new URL("../../../templates/basic-app", import.meta.url));
const cliPath = fileURLToPath(new URL("../bin/goribu.js", import.meta.url));
const appDir = mkdtempSync(join(tmpdir(), "goribu-starter-test-"));
const clientDir = join(appDir, "dist", "client");
const workerConfig = join(appDir, "dist", "goribu_starter", "wrangler.json");

beforeAll(() => {
  // Build a disposable source copy so tests cannot overwrite a running dev
  // server's generated files or touch a maintainer's local resource data.
  cpSync(sourceDir, appDir, {
    recursive: true,
    filter: (path) => !["node_modules", "dist", ".goribu", ".wrangler"]
      .some((name) => path === join(sourceDir, name)),
  });
  // Reuse installed dependencies for this integration test. The separate packed
  // package install check is what proves independence from the workspace.
  symlinkSync(join(sourceDir, "node_modules"), join(appDir, "node_modules"), "dir");
  const result = spawnSync(process.execPath, [cliPath, "build"], {
    cwd: appDir,
    env: { ...process.env, NODE_ENV: "production" },
    encoding: "utf8",
    timeout: 100000,
  });
  expect(result.error, String(result.error)).toBeUndefined();
  expect(result.status, `${result.stdout ?? ""}\n${result.stderr ?? ""}`).toBe(0);
}, 120000);

afterAll(() => {
  rmSync(appDir, { recursive: true, force: true });
});

describe("starter production output", () => {
  it("prerenders the home page with compiled Tailwind and hashed browser assets", () => {
    const html = readFileSync(join(clientDir, "index.html"), "utf8");
    const dom = new JSDOM(html);
    try {
      const document = dom.window.document;
      expect(document.documentElement.lang).toBe("en");
      expect(document.querySelector('meta[name="viewport"]').content)
        .toContain("width=device-width");
      expect(document.title).toBe("Hello from Goribu");
      expect(document.querySelector("button").textContent).toBe("Count: 0");
      expect(document.querySelector('script[type="module"]').getAttribute("src"))
        .toMatch(/^\/_goribu\/assets\/client-entry-[A-Za-z0-9_-]{8}\.js$/);
      const href = document.querySelector('link[rel="stylesheet"]').getAttribute("href");
      expect(href).toMatch(/^\/_goribu\/assets\/.+-[A-Za-z0-9_-]{8}\.css$/);
      const css = readFileSync(join(clientDir, href.slice(1)), "utf8");
      expect(css).toContain(".text-4xl");
      expect(css).toContain(".bg-indigo-700");
      expect(css).not.toContain('@import "tailwindcss"');
    } finally {
      dom.window.close();
    }
  });

  it("serves request-specific props through the emitted Worker without requiring D1 or KV", async () => {
    expect(existsSync(join(clientDir, "hello.html"))).toBe(false);
    const config = JSON.parse(readFileSync(workerConfig, "utf8"));
    expect(config.d1_databases ?? []).toHaveLength(0);
    expect(config.kv_namespaces ?? []).toHaveLength(0);
    const harness = createTestHarness({ workers: [{ configPath: workerConfig }] });
    await harness.listen();
    try {
      const worker = harness.getWorker();
      for (const name of ["Astra", "<script>alert(1)</script>"]) {
        const response = await worker.fetch(`https://starter.test/hello?name=${encodeURIComponent(name)}`);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        const html = await response.text();
        const dom = new JSDOM(html);
        try {
          expect(dom.window.document.querySelector("h1").textContent).toBe(`Hello, ${name}.`);
          expect(dom.window.document.querySelector("h1 script")).toBeNull();
          expect(JSON.parse(dom.window.document.getElementById("__GORIBU_PROPS__").textContent))
            .toEqual({ name });
        } finally {
          dom.window.close();
        }
      }
    } finally {
      await harness.close();
    }
  }, 30000);
});
