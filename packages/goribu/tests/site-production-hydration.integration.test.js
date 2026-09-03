import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestHarness } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("../bin/goribu.js", import.meta.url));
const siteDir = fileURLToPath(new URL("../../../site", import.meta.url));
const clientDir = join(siteDir, "dist", "client");
const workerConfig = join(siteDir, "dist", "goribu_site", "wrangler.json");
const productionEntry =
  /\/_goribu\/assets\/client-entry-[A-Za-z0-9_-]{8}\.js/;
const productionStyle =
  /\/_goribu\/assets\/[^"/]+-[A-Za-z0-9_-]{8}\.css/;

let build;

function cleanBuildOutput() {
  for (const dir of ["dist", ".goribu", ".wrangler"]) {
    rmSync(join(siteDir, dir), { recursive: true, force: true });
  }
}

beforeAll(() => {
  cleanBuildOutput();
  const result = spawnSync(process.execPath, [cliPath, "build"], {
    cwd: siteDir,
    encoding: "utf8",
    timeout: 100000,
  });
  build = {
    status: result.status,
    error: result.error,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  };
}, 120000);

afterAll(() => {
  cleanBuildOutput();
});

describe("site production hydration", () => {
  it("builds the client before the Worker and completes static output", () => {
    expect(build.error, String(build.error)).toBeUndefined();
    expect(build.status, build.output).toBe(0);
    expect(build.output.indexOf("building client environment")).toBeGreaterThan(-1);
    expect(build.output.indexOf("building goribu_site environment")).toBeGreaterThan(
      build.output.indexOf("building client environment"),
    );
  });

  it("writes a static landing page with a hashed entry and a hydrated-only control", () => {
    const indexFile = join(clientDir, "index.html");
    expect(existsSync(indexFile)).toBe(true);
    const html = readFileSync(indexFile, "utf8");

    expect(html).toMatch(productionEntry);
    expect(html).toMatch(productionStyle);
    expect(html).toContain(
      '<title data-goribu-head="">Goribu - a React framework for Cloudflare Workers</title>',
    );
    expect(html).toContain('rel="modulepreload"');
    expect(html).not.toContain('/src/client-entry.js');
    expect(html).not.toContain(' nonce=');
    expect(html).toContain('aria-controls="why-goribu-details"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("writes the client-runtime guides as static pages with managed titles", () => {
    for (const [page, title] of [
      ["navigation", "Navigation"],
      ["forms", "Forms"],
      ["metadata", "Metadata &amp; Document"],
    ]) {
      const file = join(clientDir, "docs", `${page}.html`);
      expect(existsSync(file), page).toBe(true);
      const html = readFileSync(file, "utf8");

      expect(html).toContain(
        `<title data-goribu-head="">${title}</title>`,
      );
      expect(html).toMatch(productionEntry);
      expect(html).toMatch(productionStyle);
      expect(html).not.toContain(' nonce=');
    }
  });

  it("renders the Worker-owned feedback route with the same hashed entry", async () => {
    const harness = createTestHarness({ workers: [{ configPath: workerConfig }] });
    await harness.listen();
    const worker = harness.getWorker();
    try {
      const response = await worker.fetch("https://goribu.test/feedback");
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toMatch(productionEntry);
      expect(html).toMatch(productionStyle);
      expect(html).toContain('rel="modulepreload"');
      expect(html).not.toContain('/src/client-entry.js');
      expect(html).toContain(
        '<title data-goribu-head="">Feedback - Goribu</title>',
      );

      const nonce = /'nonce-([a-f0-9]{32})'/.exec(
        response.headers.get("content-security-policy"),
      )?.[1];
      expect(nonce).toMatch(/^[a-f0-9]{32}$/);
      expect(html.match(new RegExp(`nonce="${nonce}"`, "g"))).toHaveLength(3);
    } finally {
      await harness.close();
    }
  });
});
