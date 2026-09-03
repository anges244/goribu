import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  });
  const { outputFile } = writeWranglerConfig({ projectRoot: root, appConfig });
  const config = JSON.parse(readFileSync(outputFile, "utf8"));
  delete config.assets;
  writeFileSync(outputFile, `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(
    join(root, ".goribu", "worker.js"),
    `export default {
      async fetch(_request, env) {
        await env.DB.exec("CREATE TABLE IF NOT EXISTS proof (value TEXT)");
        await env.DB.prepare("INSERT INTO proof (value) VALUES (?)").bind("local").run();
        const row = await env.DB.prepare("SELECT value FROM proof LIMIT 1").first();
        return Response.json(row);
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
  it("executes SQL through the synthesized DB binding", async () => {
    const response = await worker.fetch("https://goribu.test/");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ value: "local" });
  });
});
