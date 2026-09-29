import { spawn as nodeSpawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { runDeploy, validateProductionSecrets } from "../src/build/run-deploy.js";

it("uses real Wrangler to reject invalid secrets before any deployment mutation, without credentials or secret output", async () => {
  const root = mkdtempSync(join(tmpdir(), "goribu-production-secrets-"));
  const accountId = "a".repeat(32);
  const secretsFile = ".env.production";
  const path = join(root, secretsFile);
  const env = { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: join(root, "wrangler.log") };
  for (const name of Object.keys(env)) if (/^(CLOUDFLARE_|CF_)/.test(name)) delete env[name];
  const spawn = (command, args, options) => {
    expect(args).toContain("--dry-run");
    expect(options.stdio).toBe("ignore");
    expect(options.env.CLOUDFLARE_ACCOUNT_ID).toBe(accountId);
    return nodeSpawn(command, args, { ...options, env: { ...env, CLOUDFLARE_ACCOUNT_ID: options.env.CLOUDFLARE_ACCOUNT_ID } });
  };
  try {
    // A built Worker with an unprovisioned D1 binding: validation must not need
    // the UUID or credentials that the later provisioning stage will supply.
    writeFileSync(join(root, "worker.js"), 'export default { fetch() { return new Response("test"); } };');
    writeFileSync(join(root, "wrangler.json"), JSON.stringify({
      name: "goribu-secret-preflight", main: "worker.js", compatibility_date: "2026-09-11",
      d1_databases: [{ binding: "DB", database_name: "test-db", preview_database_id: "test-db" }],
    }));
    const provision = vi.fn(async () => null);
    const provisionKV = vi.fn(async () => null);
    const migrate = vi.fn();
    const deploy = vi.fn(async () => 0);
    const options = {
      projectRoot: root, build: async () => {}, stdout: { write() {} },
      getAccess: async () => ({ accountId }),
      loadConfig: async () => defineConfig({ name: "goribu-secret-preflight", compatibilityDate: "2026-09-11" }),
      validateSecrets: (input) => validateProductionSecrets({ ...input, spawn }),
      provision, provisionKV, migrate, deploy,
    };
    for (const content of ["not an assignment", "", '{"TOKEN":123}']) {
      writeFileSync(path, content);
      await expect(runDeploy(options)).rejects.toThrow(/\[Goribu\].*could not validate .env.production/);
      for (const stage of [provision, provisionKV, migrate, deploy]) expect(stage).not.toHaveBeenCalled();
    }
    rmSync(path);
    mkdirSync(path);
    await expect(runDeploy(options)).rejects.toThrow(/could not validate/);
    rmSync(path, { recursive: true });
    symlinkSync(join(root, "missing-file"), path);
    await expect(runDeploy(options)).rejects.toThrow(/could not validate/);
    rmSync(path);

    for (const content of ["API_KEY=synthetic-value\nPUBLIC_SITE_NAME=public-value\n", '{"API_KEY":"synthetic-value"}']) {
      writeFileSync(path, content);
      await expect(runDeploy(options)).resolves.toBe(0);
      expect(deploy).toHaveBeenLastCalledWith({ projectRoot: root, secretsFile, accountId });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 60000);
