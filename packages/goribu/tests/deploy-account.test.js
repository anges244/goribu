import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { runDeploy, runWranglerDeploy, validateProductionSecrets } from "../src/build/run-deploy.js";

it.each([
  ["no resources", {}],
  ["D1", { database: { type: "d1", name: "test-db" } }],
  ["KV", { kv: { name: "test-kv" } }],
])("pins both Wrangler children to the selected account for %s", async (_label, resources) => {
  const projectRoot = mkdtempSync(join(tmpdir(), "goribu-deploy-account-"));
  const accountId = "a".repeat(32);
  const otherAccount = "b".repeat(32);
  const parentAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  const calls = [];
  const spawn = (_command, args, options) => {
    // Inspect only the selection, never the rest of the inherited environment.
    calls.push({ dryRun: args.includes("--dry-run"), accountId: options.env?.CLOUDFLARE_ACCOUNT_ID });
    expect(options.env?.PATH === process.env.PATH).toBe(true);
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("close", 0, null));
    return child;
  };
  const provision = vi.fn(async ({ getAccess }) => {
    expect((await getAccess()).accountId).toBe(accountId);
    return null;
  });
  try {
    writeFileSync(join(projectRoot, ".env"), `CLOUDFLARE_ACCOUNT_ID=${otherAccount}\n`);
    writeFileSync(join(projectRoot, ".env.production"), "EXAMPLE=synthetic-value\n");
    const launch = { spawn, resolveBin: () => "/test/wrangler.js" };
    await expect(runDeploy({
      projectRoot, stdout: { write() {} }, build: async () => {},
      loadConfig: async () => defineConfig({ name: "test-app", compatibilityDate: "2026-09-01", ...resources }),
      getAccess: async () => ({ accountId, headers: {} }),
      provision, provisionKV: provision,
      validateSecrets: (input) => validateProductionSecrets({ ...input, ...launch }),
      deploy: (input) => runWranglerDeploy({ ...input, ...launch }),
    })).resolves.toBe(0);
    expect(calls).toEqual([{ dryRun: true, accountId }, { dryRun: false, accountId }]);
    expect(provision).toHaveBeenCalledTimes(2);
    expect(process.env.CLOUDFLARE_ACCOUNT_ID === parentAccount).toBe(true);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});
