import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestHarness } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../src/build/migrations/read-migrations.js";
import { copyTestApp } from "./support/copy-test-app.js";

const cliPath = fileURLToPath(new URL("../bin/goribu.js", import.meta.url));
const siteSource = fileURLToPath(new URL("../../../site", import.meta.url));
let siteDir, clientDir, workerConfig;
const productionEntry =
  /\/_goribu\/assets\/client-entry-[A-Za-z0-9_-]{8}\.js/;
const productionStyle =
  /\/_goribu\/assets\/[^"/]+-[A-Za-z0-9_-]{8}\.css/;
const productionRoute =
  /\/_goribu\/assets\/client-route-[A-Za-z0-9_-]{8}\.js/;

let build;

beforeAll(() => {
  siteDir = copyTestApp(siteSource, "goribu-site-test-", ["plugins", "migrations"]);
  clientDir = join(siteDir, ".goribu", "dist", "client");
  workerConfig = join(siteDir, ".goribu", "dist", "goribu_site", "wrangler.json");
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
  if (siteDir) rmSync(siteDir, { recursive: true, force: true });
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
    expect(html).not.toContain('/src/setup/client-entry.js');
    expect(html).not.toMatch(/<[a-z][^>]*\snonce=/i);
    expect(html).toContain('aria-controls="why-goribu-details"');
    expect(html).toContain('aria-expanded="false"');

    const routeChunks = readdirSync(join(clientDir, "_goribu", "assets"))
      .filter((fileName) => fileName.startsWith("client-route"));
    expect(routeChunks.length).toBeGreaterThan(0);
    expect(
      routeChunks.every((fileName) =>
        /^client-route-[A-Za-z0-9_-]{8}\.js$/.test(fileName),
      ),
    ).toBe(true);
  });

  it("writes the client-runtime guides as static pages with managed titles", () => {
    for (const [page, title] of [
      ["navigation", "Navigation"],
      ["forms", "Forms"],
      ["d1", "D1"],
      ["migrations", "Migrations"],
      ["kv", "KV"],
      ["metadata", "Metadata &amp; Document"],
      ["environment-variables", "Environment variables"],
    ]) {
      const file = join(clientDir, "docs", `${page}.html`);
      expect(existsSync(file), page).toBe(true);
      const html = readFileSync(file, "utf8");

      expect(html).toContain(
        `<title data-goribu-head="">${title}</title>`,
      );
      expect(html).toMatch(productionEntry);
      expect(html).toMatch(productionStyle);
      expect(html).not.toMatch(/<[a-z][^>]*\snonce=/i);
    }
  });

  it("persists feedback through the Worker-owned req.d1 route", async () => {
    expect(existsSync(join(clientDir, "feedback.html"))).toBe(false);
    const harness = createTestHarness({ workers: [{ configPath: workerConfig }] });
    await harness.listen();
    const worker = harness.getWorker();
    try {
      // Production routes no longer bootstrap schema during requests. Apply the site's
      // real migration to the otherwise-empty test binding before exercising /feedback.
      const [migration] = readMigrations({
        migrationsDir: join(siteDir, "migrations"),
      });
      const env = await worker.getEnv();
      await env.DB.prepare(migration.upSql).run();

      const response = await worker.fetch("https://goribu.test/feedback");
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toMatch(productionEntry);
      expect(html).toMatch(productionStyle);
      expect(html).toMatch(productionRoute);
      expect(html).toContain('rel="modulepreload"');
      expect(html).not.toContain('/src/setup/client-entry.js');
      expect(html).toContain(
        '<title data-goribu-head="">Feedback - Goribu</title>',
      );

      const nonce = /'nonce-([a-f0-9]{32})'/.exec(
        response.headers.get("content-security-policy"),
      )?.[1];
      expect(nonce).toMatch(/^[a-f0-9]{32}$/);
      expect(html.match(new RegExp(`nonce="${nonce}"`, "g"))).toHaveLength(3);
      expect(html).toContain("No feedback has been sent yet.");

      const sent = await worker.fetch("https://goribu.test/feedback", {
        method: "POST",
        body: new URLSearchParams({
          message: "Stored through req.d1",
          intent: "send",
        }),
        headers: {
          accept: "application/vnd.goribu.form+json",
          referer: "https://goribu.test/feedback",
        },
        redirect: "manual",
      });

      expect(sent.status).toBe(303);
      expect(sent.headers.get("location")).toBeNull();
      await expect(sent.clone().json()).resolves.toEqual({
        type: "redirect",
        to: "/feedback/thanks",
      });
      const bookmark = sent.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith("goribu_d1_bookmark="));
      expect(bookmark).toBeDefined();

      const afterWrite = await worker.fetch("https://goribu.test/feedback", {
        headers: { cookie: bookmark.split(";", 1)[0] },
      });
      expect(afterWrite.status).toBe(200);
      await expect(afterWrite.text()).resolves.toContain("Stored through req.d1");

      // WorkerHandle's RPC transport does not serialize a FormData instance as an HTTP
      // multipart body. Send the wire representation explicitly so this exercises the
      // native browser form path and its normalized field object inside the Worker.
      const boundary = "----goribu-native-form-test";
      const nativeBody = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="message"',
        "",
        "Stored through native multipart",
        `--${boundary}`,
        'Content-Disposition: form-data; name="intent"',
        "",
        "send",
        `--${boundary}--`,
        "",
      ].join("\r\n");
      const native = await harness.fetch("https://goribu.test/feedback", {
        method: "POST",
        body: nativeBody,
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        redirect: "manual",
      });

      expect(native.status).toBe(303);
      expect(native.headers.get("location")).toBe("/feedback/thanks");
      const nativeBookmark = native.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith("goribu_d1_bookmark="));
      expect(nativeBookmark).toBeDefined();

      const afterNativeWrite = await worker.fetch("https://goribu.test/feedback", {
        headers: { cookie: nativeBookmark.split(";", 1)[0] },
      });
      expect(afterNativeWrite.status).toBe(200);
      await expect(afterNativeWrite.text()).resolves.toContain(
        "Stored through native multipart",
      );

      // The public feed fills KV from D1, then serves the saved snapshot even
      // while newer feedback exists. The submission page stays read-your-writes.
      expect(existsSync(join(clientDir, "community.html"))).toBe(false);
      const feed = await worker.fetch("https://goribu.test/community");
      expect(feed.status).toBe(200);
      expect(feed.headers.get("cache-control")).toBe("no-store");
      expect(await feed.text()).toContain("Stored through native multipart");
      const cached = await env.KV.get("community-feedback:v1", "json");
      expect(cached.entries).toHaveLength(2);
      expect(cached.generatedAt).toEqual(expect.any(String));

      await env.DB.prepare("INSERT INTO feedback (message, created_at) VALUES (?, ?)")
        .bind("Newer than the saved snapshot", new Date().toISOString()).run();
      const stillCached = await worker.fetch("https://goribu.test/community");
      const cachedHtml = await stillCached.text();
      expect(stillCached.status).toBe(200);
      expect(cachedHtml).toContain(cached.generatedAt);
      expect(cachedHtml).not.toContain("Newer than the saved snapshot");

      await env.KV.delete("community-feedback:v1");
      const refreshed = await worker.fetch("https://goribu.test/community");
      expect(refreshed.status).toBe(200);
      expect(await refreshed.text()).toContain("Newer than the saved snapshot");
    } finally {
      await harness.close();
    }
  });
});
