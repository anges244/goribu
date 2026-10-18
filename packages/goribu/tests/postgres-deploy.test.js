import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { runDeploy } from "../src/build/run-deploy.js";
import { runCheck } from "../src/build/run-check.js";
import { readPostgresEnv } from "../src/build/postgres/read-postgres-env.js";
import { filterProductionSecrets } from "../src/build/postgres/filter-production-secrets.js";

const base = { name: "app", compatibilityDate: "2026-09-23", database: { type: "postgres" } };
const appConfig = defineConfig(base);
const access = { accountId: "a".repeat(32), headers: {} };
const hyperdrive = { id: "b".repeat(32), cachedId: "c".repeat(32) };
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function harness(config = appConfig) {
  const projectRoot = mkdtempSync(join(tmpdir(), "goribu-postgres-deploy-"));
  roots.push(projectRoot);
  // The URL preflight is injected. Empty removal markers exercise the real filter
  // without ever writing a connection string or password into the fixture.
  writeFileSync(join(projectRoot, ".env.production"), "POSTGRES_URL=\nPOSTGRES_MIGRATE_URL=\nKEEP=test-value\n");
  const events = [];
  let output = "", filteredPath;
  const record = (name, result) => vi.fn(async () => { events.push(name); return result; });
  const options = {
    projectRoot, loadConfig: vi.fn(async () => config), stdout: { write(text) { output += text; } },
    readPostgresEnv: record("read-env"), getAccess: record("auth", access), build: record("build"),
    finalizeR2Account: vi.fn(() => events.push("r2-account")),
    filterProductionSecrets: vi.fn((args) => {
      events.push("filter");
      const filtered = filterProductionSecrets(args);
      filteredPath = filtered.secretsFile;
      return { secretsFile: filteredPath, cleanup() { events.push("cleanup"); filtered.cleanup(); } };
    }),
    validateSecrets: vi.fn(async ({ secretsFile }) => {
      events.push("validate");
      expect(JSON.parse(readFileSync(secretsFile, "utf8"))).toEqual({ KEEP: "test-value" });
      expect(statSync(secretsFile).mode & 0o777).toBe(0o600);
    }),
    listWorkerSecretNames: record("list-secrets", []),
    inspectAppDomain: record("inspect-domain", { action: "none", name: "app.example.com", otherDomains: [], warnings: [] }),
    provisionR2: record("r2", { uploads: { keys: "missing" } }),
    provisionHyperdrive: record("hyperdrive", hyperdrive),
    finalizeHyperdriveBindings: vi.fn(() => events.push("finalize-hyperdrive")),
    provisionKV: record("kv", null), finalizeKV: vi.fn(() => events.push("finalize-kv")),
    runPostgresMigrate: record("postgres-migrate"),
    provision: vi.fn(), finalize: vi.fn(), migrate: vi.fn(),
    ensureR2SigningSecret: record("r2-secret"), ensureR2UploadKeys: record("r2-keys"),
    deploy: vi.fn(async ({ secretsFile }) => {
      events.push("upload");
      if (secretsFile) expect(JSON.parse(readFileSync(secretsFile, "utf8"))).toEqual({ KEEP: "test-value" });
      return 0;
    }),
    provisionAppDomain: record("attach-domain"),
  };
  return { options, events, output: () => output, path: () => filteredPath, run: () => runDeploy(options) };
}

describe("Postgres deploy", () => {
  it("validates, filters, provisions, finalizes, migrates and uploads in order alongside KV, R2 and domains", async () => {
    const config = defineConfig({ ...base, kv: { name: "app-kv" }, r2: { name: "app-files" }, domain: "app.example.com" });
    const h = harness(config);
    const namespace = { id: "d".repeat(32), title: "app-kv" };
    h.options.provisionKV.mockImplementation(async () => { h.events.push("kv"); return namespace; });
    await expect(h.run()).resolves.toBe(0);
    expect(h.events).toEqual([
      "read-env", "auth", "build", "r2-account", "filter", "validate", "list-secrets", "inspect-domain",
      "r2", "hyperdrive", "finalize-hyperdrive", "kv", "finalize-kv", "postgres-migrate",
      "r2-secret", "r2-keys", "upload", "attach-domain", "cleanup",
    ]);
    const { projectRoot, stdout } = h.options;
    expect(h.options.readPostgresEnv).toHaveBeenCalledWith({ projectRoot, target: "production" });
    expect(h.options.provisionHyperdrive).toHaveBeenCalledWith({ projectRoot, appConfig: config, access, stdout });
    expect(h.options.finalizeHyperdriveBindings).toHaveBeenCalledWith({ projectRoot, appConfig: config, hyperdrive });
    const migration = h.options.runPostgresMigrate.mock.calls[0][0];
    expect(migration).toMatchObject({ projectRoot, target: "remote", stdout });
    expect(await migration.loadConfig()).toBe(config);
    expect(h.options.loadConfig).toHaveBeenCalledOnce();
    for (const stage of [h.options.provision, h.options.finalize, h.options.migrate]) expect(stage).not.toHaveBeenCalled();
    expect(h.options.validateSecrets).toHaveBeenCalledWith({ projectRoot, secretsFile: h.path(), accountId: access.accountId });
    expect(h.options.deploy).toHaveBeenCalledWith({ projectRoot, secretsFile: h.path(), accountId: access.accountId });
    expect(existsSync(dirname(h.path()))).toBe(false);
    expect(h.output()).toContain("Secrets: upload remaining entries from .env.production; POSTGRES_URL and POSTGRES_MIGRATE_URL are excluded; preserve other existing secrets.");
  });

  it("blocks upload on migration failure and removes the filtered file on every later failure", async () => {
    for (const stage of ["validateSecrets", "listWorkerSecretNames", "provisionR2", "provisionHyperdrive", "finalizeHyperdriveBindings", "runPostgresMigrate", "deploy"]) {
      const h = harness();
      h.options[stage].mockImplementation(() => { throw new Error(`failed ${stage}`); });
      await expect(h.run()).rejects.toThrow(`failed ${stage}`);
      expect(h.events.at(-1)).toBe("cleanup");
      expect(h.events.filter((event) => event === "cleanup")).toHaveLength(1);
      expect(existsSync(dirname(h.path()))).toBe(false);
      if (stage !== "deploy") expect(h.options.deploy).not.toHaveBeenCalled();
      if (stage === "validateSecrets") expect(h.options.provisionHyperdrive).not.toHaveBeenCalled();
      if (stage === "finalizeHyperdriveBindings") expect(h.options.runPostgresMigrate).not.toHaveBeenCalled();
    }
  });

  it("cleans up after an unsuccessful upload exit code or failed domain attachment", async () => {
    const h = harness(defineConfig({ ...base, domain: "app.example.com" }));
    h.options.deploy.mockResolvedValueOnce(2);
    await expect(h.run()).resolves.toBe(2);
    expect(h.options.provisionAppDomain).not.toHaveBeenCalled();
    expect(existsSync(dirname(h.path()))).toBe(false);
    h.options.provisionAppDomain.mockRejectedValueOnce(new Error("domain failed"));
    await expect(h.run()).rejects.toThrow(/Worker app was deployed.*domain failed/);
    expect(existsSync(dirname(h.path()))).toBe(false);
  });

  it("rejects missing or invalid production URLs before authentication, including BYO apps", async () => {
    const byo = defineConfig({ ...base, database: { type: "postgres", hyperdriveId: hyperdrive.id, hyperdriveCachedId: hyperdrive.cachedId } });
    for (const config of [appConfig, byo]) {
      for (const contents of [undefined, "KEEP=test-value", "POSTGRES_URL=invalid"]) {
        const h = harness(config);
        const filename = join(h.options.projectRoot, ".env.production");
        if (contents === undefined) rmSync(filename);
        else writeFileSync(filename, contents);
        h.options.readPostgresEnv = readPostgresEnv;
        await expect(h.run()).rejects.toThrow(/\[Goribu\].*(\.env.production|POSTGRES_URL)/);
        for (const stage of [h.options.getAccess, h.options.build, h.options.filterProductionSecrets, h.options.provisionHyperdrive, h.options.deploy]) {
          expect(stage).not.toHaveBeenCalled();
        }
      }
    }
  });

  it("omits the secrets file when only Postgres keys remain and keeps platform secrets", async () => {
    const h = harness();
    writeFileSync(join(h.options.projectRoot, ".env.production"), "POSTGRES_URL=\nPOSTGRES_MIGRATE_URL=\n");
    await expect(h.run()).resolves.toBe(0);
    expect(h.options.validateSecrets).not.toHaveBeenCalled();
    expect(h.options.deploy).toHaveBeenCalledWith({ projectRoot: h.options.projectRoot, secretsFile: undefined, accountId: access.accountId });
    expect(h.output()).toContain("Secrets: use existing platform secrets; POSTGRES_URL and POSTGRES_MIGRATE_URL are excluded from upload.");
    expect(h.events.at(-1)).toBe("cleanup");
  });

  it("warns about stale URL secrets with exact manual delete commands and continues uploading", async () => {
    const h = harness();
    h.options.listWorkerSecretNames.mockResolvedValue(["POSTGRES_URL", "POSTGRES_MIGRATE_URL", "UNRELATED"]);
    await expect(h.run()).resolves.toBe(0);
    for (const name of ["POSTGRES_URL", "POSTGRES_MIGRATE_URL"]) {
      expect(h.output()).toContain(`[Goribu] Warning: Worker app already has a ${name} secret from an earlier deploy. Goribu excludes it from this upload but does not delete existing secrets. Remove it with \`pnpm exec goribu wrangler secret delete ${name} --name app\`.`);
    }
    expect(h.output()).not.toContain("UNRELATED");
    expect(h.options.listWorkerSecretNames).toHaveBeenCalledWith({
      projectRoot: h.options.projectRoot, appConfig, access, allowMissingWorker: true,
    });
    expect(h.options.deploy).toHaveBeenCalledOnce();
  });

  it("prints the Postgres check line without inspecting Postgres or requiring a production URL", async () => {
    const h = harness();
    rmSync(join(h.options.projectRoot, ".env.production"));
    let output = "";
    const inspectD1 = vi.fn(), inspectMigrations = vi.fn(), getAccess = vi.fn();
    await runCheck({ projectRoot: h.options.projectRoot, loadConfig: async () => appConfig,
      stdout: { write(text) { output += text; } }, inspectD1, inspectMigrations, getAccess });
    expect(output.split("\n").filter((line) => line.startsWith("Postgres:"))).toEqual([
      "Postgres: not inspected by check yet. Deploy creates or updates the Hyperdrive configs and applies pending migrations before upload.",
    ]);
    for (const inspect of [inspectD1, inspectMigrations, getAccess]) expect(inspect).not.toHaveBeenCalled();
    expect(output).toContain("No changes were made.");
  });
});
