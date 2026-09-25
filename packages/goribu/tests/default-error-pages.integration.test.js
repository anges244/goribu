import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createTestHarness } from "wrangler";
import { afterAll, beforeAll, expect, it } from "vitest";

const fixture = fileURLToPath(
  new URL("../../../fixtures/basic-app", import.meta.url),
);
const cli = fileURLToPath(new URL("../bin/goribu.js", import.meta.url));
const ray = "8fa123456789abcd-ATH";
let root, harness;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "goribu-default-errors-"));
  cpSync(join(fixture, "src"), join(root, "src"), { recursive: true });
  cpSync(join(fixture, "package.json"), join(root, "package.json"));
  symlinkSync(join(fixture, "node_modules"), join(root, "node_modules"), "dir");
  for (const file of [
    "src/routes/_404.jsx",
    "src/routes/_500.jsx",
    "src/setup/_document.jsx",
  ])
    rmSync(join(root, file));
  // This fixture has no application stylesheet: the defaults must bring their own.
  writeFileSync(
    join(root, "goribu.config.js"),
    `import { defineConfig } from "goribu/server";
export default defineConfig({ name: "default-error-pages", compatibilityDate: "2026-08-31",
  responseHeaders: ({ nonce }) => ({
    "content-security-policy": "default-src 'none'; style-src 'nonce-" + nonce + "'; script-src 'nonce-" + nonce + "' 'strict-dynamic'",
  }),
});`,
  );
  writeFileSync(
    join(root, "vite.config.js"),
    'import { goribu } from "goribu/vite"; export default { plugins: [goribu()] };',
  );
  writeFileSync(
    join(root, "src/routes/missing-result.js"),
    'export function GET(req, res) { return res.notFound({ secret: "handler-only" }); }',
  );
  const result = spawnSync(process.execPath, [cli, "build"], {
    cwd: root,
    encoding: "utf8",
    timeout: 100000,
    env: { ...process.env, NODE_ENV: "production" },
  });
  expect(result.error, String(result.error)).toBeUndefined();
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  harness = createTestHarness({
    workers: [
      {
        configPath: join(
          root,
          ".goribu/dist/default_error_pages/wrangler.json",
        ),
      },
    ],
  });
  await harness.listen();
}, 120000);

afterAll(async () => {
  await harness?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

it("serves styled built-in 404s without app CSS, including handler notFound results", async () => {
  for (const path of ["/missing", "/missing-result"]) {
    const response = await harness
      .getWorker()
      .fetch(`https://errors.test${path}?secret=query-only`, {
        headers: { "cf-ray": ray },
      });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const html = await response.text();
    const dom = new JSDOM(html);
    try {
      const doc = dom.window.document;
      expect(doc.querySelector('link[rel="stylesheet"]')).toBeNull();
      expect(doc.querySelector("style").textContent).toContain(".goribu-error");
      expect(response.headers.get("content-security-policy")).toContain(
        `'nonce-${doc.querySelector("style").nonce}'`,
      );
      expect(doc.querySelector("h1").textContent).toBe("Page not found.");
      expect(doc.querySelector("dl").textContent).toContain(ray);
      expect(html).not.toMatch(/query-only|handler-only/);
    } finally {
      dom.window.close();
    }
  }
});

it("renders production 500 diagnostics and preserves the HEAD boundary", async () => {
  const response = await harness
    .getWorker()
    .fetch("https://errors.test/boom?secret=query-only", {
      headers: { "cf-ray": ray },
    });
  const html = await response.text();
  const dom = new JSDOM(html);
  try {
    const doc = dom.window.document;
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const props = JSON.parse(
      doc.getElementById("__GORIBU_PROPS__").textContent,
    );
    expect(props).toEqual({
      url: "/boom",
      errorId: expect.any(String),
      cfRay: ray,
    });
    expect(doc.querySelector("dl").textContent).toContain(props.errorId);
    expect(response.headers.get("content-security-policy")).toContain(
      `'nonce-${doc.querySelector("style").nonce}'`,
    );
    expect(doc.querySelector("a").href).toBe("https://errors.test/boom?secret=query-only");
    expect(doc.body.textContent).not.toContain("query-only");
    expect(html).not.toContain("fixture boom secret");
  } finally {
    dom.window.close();
  }
  for (const path of ["/missing", "/boom"]) {
    const head = await harness
      .getWorker()
      .fetch(`https://errors.test${path}`, { method: "HEAD" });
    expect(head.status).toBe(path === "/boom" ? 500 : 404);
    expect(await head.text()).toBe("");
  }
});
