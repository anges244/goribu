import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestHarness } from "wrangler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeWranglerConfig } from "../src/build/generate-wrangler-config.js";
import { defineConfig } from "../src/runtime/application-config.js";

let root;
let harness;
let worker;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "goribu-local-d1-"));
  const appConfig = defineConfig({
    name: "local-d1-app",
    compatibilityDate: "2026-09-03",
    database: { type: "d1", name: "local-d1-app-db" },
    kv: { name: "local-d1-app-kv" },
  });
  const { outputFile, config } = writeWranglerConfig({ projectRoot: root, appConfig });
  delete config.assets;
  writeFileSync(outputFile, `${JSON.stringify(config, null, 2)}\n`);
  const serverModule = fileURLToPath(new URL("../src/server.js", import.meta.url));
  mkdirSync(join(root, ".goribu"), { recursive: true });
  writeFileSync(
    join(root, ".goribu", "worker.js"),
    `import { createApp, defineConfig } from ${JSON.stringify(serverModule)};

    const route = {
      id: "runtime",
      pattern: "/runtime",
      segments: [{ type: "static", value: "runtime" }],
      hasDefaultExport: false,
      methods: ["GET", "POST"],
    };
    const app = createApp({
      mode: "production",
      manifest: [route],
      errorPages: { notFound: null, serverError: null },
      middlewareByRoute: new Map([[route.id, []]]),
      modules: new Map([[route.id, {
        async GET(req, res) {
          await req.d1\`CREATE TABLE IF NOT EXISTS proof (value TEXT)\`.run();
          if (!req.query.has("read")) await req.d1\`INSERT INTO proof (value) VALUES (\${"runtime"})\`.run();
          const value = await req.d1\`SELECT value FROM proof ORDER BY rowid DESC LIMIT 1\`.value();
          return res.json({ value });
        },
        async POST(req, res) {
          const { value } = await req.body();
          await req.d1\`CREATE TABLE IF NOT EXISTS proof (value TEXT)\`.run();
          await req.d1\`INSERT INTO proof (value) VALUES (\${value})\`.run();
          return res.redirect("/runtime?read");
        },
      }]]),
      applicationConfig: defineConfig({
        name: "local-d1-app",
        compatibilityDate: "2026-09-03",
        database: { type: "d1", name: "local-d1-app-db" },
      }),
    });

    export default {
      async fetch(request, env, ctx) {
        if (new URL(request.url).pathname === "/binding") {
          await env.KV.put("proof", "local");
          await env.DB.exec("CREATE TABLE IF NOT EXISTS direct_proof (value TEXT)");
          await env.DB.prepare("INSERT INTO direct_proof (value) VALUES (?)").bind(await env.KV.get("proof")).run();
          const row = await env.DB.prepare("SELECT value FROM direct_proof LIMIT 1").first();
          return Response.json(row);
        }
        return app.fetch(request, env, ctx);
      }
    };\n`,
  );
  harness = createTestHarness({ workers: [{ configPath: outputFile }] });
  await harness.listen();
  worker = harness.getWorker();
});

afterAll(async () => {
  await harness?.close();
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
});

describe("local D1 binding", () => {
  it("reads local KV and executes SQL through both synthesized bindings", async () => {
    const response = await worker.fetch("https://goribu.test/binding");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ value: "local" });
  });

  it("round-trips tagged queries and the replica bookmark through req.d1", async () => {
    const first = await worker.fetch("https://goribu.test/runtime");
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({ value: "runtime" });
    const bookmark = first.headers.get("set-cookie");
    expect(bookmark).toMatch(/^goribu_d1_bookmark=.+/);

    const second = await worker.fetch("https://goribu.test/runtime", {
      headers: { cookie: bookmark.split(";", 1)[0] },
    });
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toEqual({ value: "runtime" });
    expect(second.headers.get("set-cookie")).toMatch(/^goribu_d1_bookmark=.+/);
  });

  it("carries the bookmark on a form redirect so the next page reads the write", async () => {
    // Both the native 303 and the enhanced redirect envelope must flush the cookie.
    for (const accept of ["text/html", "application/vnd.goribu.form+json"]) {
      const value = `sent as ${accept}`;
      const sent = await worker.fetch("https://goribu.test/runtime", {
        method: "POST",
        body: new URLSearchParams({ value }),
        headers: { accept },
        redirect: "manual",
      });
      expect(sent.status, accept).toBe(303);
      const bookmark = sent.headers.get("set-cookie");
      expect(bookmark, accept).toMatch(/^goribu_d1_bookmark=.+/);
      const to = sent.headers.get("location") ?? (await sent.json()).to;
      expect(to, accept).toBe("/runtime?read");

      const after = await worker.fetch(`https://goribu.test${to}`, {
        headers: { cookie: bookmark.split(";", 1)[0] },
      });
      await expect(after.json()).resolves.toEqual({ value });
    }
  });
});
