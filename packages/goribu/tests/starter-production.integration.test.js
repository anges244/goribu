import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createTestHarness } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sourceDir = fileURLToPath(new URL("../../../templates/basic-app", import.meta.url));
const cliPath = fileURLToPath(new URL("../bin/goribu.js", import.meta.url));
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const task = mkdtempSync(join(tmpdir(), "goribu-starter-test-"));
const version = JSON.parse(readFileSync(join(repository, "packages/create-goribu/package.json"), "utf8")).version;

beforeAll(() => {
  // Both builds start from the actual packed CLI and its generated outputs.
  succeeds(spawnSync("pnpm", ["--dir", "packages/create-goribu", "pack", "--pack-destination", task], {
    cwd: repository, encoding: "utf8", timeout: 30000,
  }));
  succeeds(spawnSync("tar", ["-xzf", join(task, `create-goribu-${version}.tgz`), "-C", task], { encoding: "utf8" }));
}, 35000);

afterAll(() => rmSync(task, { recursive: true, force: true }));

function succeeds(result) {
  expect(result.error, String(result.error)).toBeUndefined();
  expect(result.status, `${result.stdout ?? ""}\n${result.stderr ?? ""}`).toBe(0);
}

describe.each(["typescript", "javascript"])("packed %s starter production output", (language) => {
const appName = `starter-${language}`;
const appDir = join(task, appName);
const clientDir = join(appDir, ".goribu", "dist", "client");
const workerConfig = join(appDir, ".goribu", "dist", `starter_${language}`, "wrangler.json");

beforeAll(() => {
  succeeds(spawnSync(process.execPath, [join(task, "package/bin/create-goribu.js"), appName, ...(language === "javascript" ? ["--js"] : [])], {
    cwd: task, encoding: "utf8", timeout: 30000,
  }));
  // Reuse installed dependencies for this integration test. The separate packed
  // package install check is what proves independence from the workspace.
  symlinkSync(join(sourceDir, "node_modules"), join(appDir, "node_modules"), "dir");
  if (language === "typescript") {
    succeeds(spawnSync(process.execPath, [
      fileURLToPath(import.meta.resolve("typescript/bin/tsc")), "--project", join(appDir, "tsconfig.json"),
    ], { cwd: appDir, encoding: "utf8", timeout: 30000 }));
  }
  const result = spawnSync(process.execPath, [cliPath, "build"], {
    cwd: appDir,
    env: { ...process.env, NODE_ENV: "production" },
    encoding: "utf8",
    timeout: 100000,
  });
  succeeds(result);
}, 120000);

  it("prerenders the home page with compiled Tailwind and hashed browser assets", () => {
    const html = readFileSync(join(clientDir, "index.html"), "utf8");
    const dom = new JSDOM(html);
    try {
      const document = dom.window.document;
      expect(document.documentElement.lang).toBe("en");
      expect(document.querySelector('meta[name="viewport"]').content)
        .toContain("width=device-width");
      expect(document.title).toBe("Goribu — Ready when you are");
      expect(document.querySelector("h1").textContent.replace(/\s+/g, " ")).toMatch(/Ready when.*you are\./);
      expect(document.querySelector("code").textContent).toBe(`src/routes/index.${language === "typescript" ? "tsx" : "jsx"}`);
      expect(document.querySelector('a[href="https://goribu.dev/docs"]')).not.toBeNull();
      expect(document.querySelector('script[type="module"]').getAttribute("src"))
        .toMatch(/^\/_goribu\/assets\/client-entry-[A-Za-z0-9_-]{8}\.js$/);
      const href = document.querySelector('link[rel="stylesheet"]').getAttribute("href");
      expect(href).toMatch(/^\/_goribu\/assets\/.+-[A-Za-z0-9_-]{8}\.css$/);
      const css = readFileSync(join(clientDir, href.slice(1)), "utf8");
      expect(css).toContain(".bg-canvas");
      expect(css).toContain(".stroke-flow");
      expect(css).toContain("prefers-color-scheme:dark");
      expect(css).toContain("prefers-reduced-motion:reduce");
      expect(css).not.toContain('@import "tailwindcss"');
    } finally {
      dom.window.close();
    }
  });

  it("serves the single static page and returns 404 for removed demos without requiring D1 or KV", async () => {
    expect(existsSync(join(clientDir, "hello.html"))).toBe(false);
    const config = JSON.parse(readFileSync(workerConfig, "utf8"));
    expect(config.d1_databases ?? []).toHaveLength(0);
    expect(config.kv_namespaces ?? []).toHaveLength(0);
    const harness = createTestHarness({ workers: [{ configPath: workerConfig }] });
    const { url } = await harness.listen();
    try {
      const response = await fetch(new URL("/", url));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(readFileSync(join(clientDir, "index.html"), "utf8"));
      expect((await fetch(new URL("/hello?name=friend", url))).status).toBe(404);
      const index = await (await fetch(new URL("/_goribu/navigation.json", url))).json();
      expect(Object.keys(index.routes)).toEqual(["/"]);
    } finally {
      await harness.close();
    }
  }, 30000);
});
