import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import {
  resolveWranglerBin,
  runDeploy,
  runWranglerDeploy,
  validateProductionSecrets,
} from "../src/build/run-deploy.js";

const FAKE_BIN = "/fake/path/to/wrangler.js";

// A spawn stand-in that records its call and drives the returned child through a
// scripted lifecycle once the caller has attached its listeners.
function fakeSpawn(drive) {
  const calls = [];
  function spawn(command, args, options) {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    queueMicrotask(() => drive(child));
    return child;
  }
  spawn.calls = calls;
  return spawn;
}

const resolveBin = () => FAKE_BIN;
const fakeAccess = async () => ({ accountId: "account", headers: {} });
const roots = [];
function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "goribu-deploy-secrets-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("runWranglerDeploy", () => {
  it("passes the production file unchanged to Wrangler and validates it without logging parser output", async () => {
    const spawn = fakeSpawn((child) => child.emit("close", 0, null));
    const options = { projectRoot: "/app", secretsFile: ".env.production", spawn, resolveBin };
    await validateProductionSecrets(options);
    await runWranglerDeploy(options);
    expect(spawn.calls.map(({ args, options }) => ({ args, stdio: options.stdio }))).toEqual([
      { args: [FAKE_BIN, "deploy", "--dry-run", "--secrets-file=.env.production"], stdio: "ignore" },
      { args: [FAKE_BIN, "deploy", "--secrets-file=.env.production"], stdio: ["inherit", "inherit", "pipe"] },
    ]);
    await expect(validateProductionSecrets({
      ...options, spawn: fakeSpawn((child) => child.emit("close", 1, null)),
    })).rejects.toThrow(/\[Goribu\].*pnpm exec goribu wrangler deploy --dry-run --secrets-file=\.env\.production.*output may include text from the file.*No resources or migrations were changed/);
  });
  it("launches the resolved Wrangler binary with deploy in the project root", async () => {
    const spawn = fakeSpawn((child) => child.emit("close", 0, null));

    const code = await runWranglerDeploy({ projectRoot: "/app", spawn, resolveBin });

    expect(code).toBe(0);
    expect(spawn.calls).toHaveLength(1);
    expect(spawn.calls[0]).toEqual({
      command: process.execPath,
      args: [FAKE_BIN, "deploy"],
      options: { cwd: "/app", stdio: ["inherit", "inherit", "pipe"] },
    });
  });

  it("propagates a non-zero Wrangler exit code", async () => {
    const spawn = fakeSpawn((child) => child.emit("close", 2, null));

    const code = await runWranglerDeploy({ projectRoot: "/app", spawn, resolveBin });

    expect(code).toBe(2);
  });

  it("treats signal termination as failure, not success", async () => {
    const spawn = fakeSpawn((child) => child.emit("close", null, "SIGTERM"));

    await expect(
      runWranglerDeploy({ projectRoot: "/app", spawn, resolveBin }),
    ).rejects.toThrow(/terminated by signal SIGTERM/);
  });

  it("treats a null exit code with no signal as failure", async () => {
    const spawn = fakeSpawn((child) => child.emit("close", null, null));

    const code = await runWranglerDeploy({ projectRoot: "/app", spawn, resolveBin });

    expect(code).toBe(1);
  });

  it("surfaces a spawn error", async () => {
    const spawn = fakeSpawn((child) => child.emit("error", new Error("spawn ENOENT")));

    await expect(
      runWranglerDeploy({ projectRoot: "/app", spawn, resolveBin }),
    ).rejects.toThrow(/spawn ENOENT/);
  });

  it("fails closed with a teaching error when Wrangler cannot be resolved", async () => {
    const spawn = fakeSpawn((child) => child.emit("close", 0, null));
    const missingBin = () => {
      throw new Error("Cannot find module 'wrangler/package.json'");
    };

    await expect(
      runWranglerDeploy({ projectRoot: "/app", spawn, resolveBin: missingBin }),
    ).rejects.toThrow(/Could not find Wrangler/);
    expect(spawn.calls).toHaveLength(0);
  });

  it("requires a project root", async () => {
    await expect(runWranglerDeploy({ spawn: fakeSpawn(() => {}), resolveBin })).rejects.toThrow(
      /requires the application project root/,
    );
  });

  it("resolves the real Wrangler binary from the framework dependency", () => {
    const bin = resolveWranglerBin();
    expect(bin).toMatch(/wrangler\.js$/);
    expect(existsSync(bin)).toBe(true);
  });
});

describe("runDeploy", () => {
  it("inspects the app domain before provisioning and attaches it only after a successful Worker upload", async () => {
    const projectRoot = makeProject();
    const appConfig = defineConfig({ name: "app", compatibilityDate: "2026-10-02", domain: "app.example.com",
      r2: { name: "app-files" }, database: { type: "d1", name: "app-db" } });
    const access = { accountId: "a".repeat(32), headers: {} };
    const appDomain = { name: appConfig.domain, worker: appConfig.name, accountId: access.accountId,
      zoneId: "b".repeat(32), action: "connect", otherDomains: [], warnings: [] };
    const events = [];
    const options = {
      projectRoot, loadConfig: async () => appConfig, getAccess: async () => access,
      stdout: { write() {} }, build: async () => { events.push("build"); }, finalizeR2Account() {},
      inspectAppDomain: vi.fn(async () => { events.push("inspect-domain"); return appDomain; }),
      provisionR2: vi.fn(async () => { events.push("r2"); }),
      provision: async () => { events.push("d1"); return { uuid: "database-id" }; }, finalize() {},
      migrate: async () => { events.push("migrate"); }, ensureR2SigningSecret: async () => {},
      deploy: vi.fn(async () => { events.push("deploy"); return 0; }),
      provisionAppDomain: vi.fn(async () => { events.push("attach-domain"); }),
    };
    await expect(runDeploy(options)).resolves.toBe(0);
    expect(events).toEqual(["build", "inspect-domain", "r2", "d1", "migrate", "deploy", "attach-domain"]);
    expect(options.inspectAppDomain).toHaveBeenCalledWith({ projectRoot, appConfig, access });
    expect(options.provisionR2.mock.calls[0][0].appDomain).toBe(appDomain);
    expect(options.provisionAppDomain).toHaveBeenCalledWith({ projectRoot, appConfig, access, stdout: options.stdout });

    events.length = 0;
    options.deploy.mockResolvedValueOnce(2);
    await expect(runDeploy(options)).resolves.toBe(2);
    expect(events).not.toContain("attach-domain");
    options.deploy.mockRejectedValueOnce(new Error("upload interrupted"));
    await expect(runDeploy(options)).rejects.toThrow("upload interrupted");
    expect(options.provisionAppDomain).toHaveBeenCalledOnce();

    events.length = 0;
    options.inspectAppDomain.mockRejectedValueOnce(new Error("hostname is occupied"));
    await expect(runDeploy(options)).rejects.toThrow("hostname is occupied");
    expect(events).toEqual(["build"]);
  });

  it("reports a successful Worker upload separately when domain attachment cannot be confirmed", async () => {
    const projectRoot = makeProject();
    const appConfig = defineConfig({ name: "app", compatibilityDate: "2026-10-02", domain: "app.example.com" });
    const deploy = vi.fn(async () => 0);
    const cause = new Error("[Goribu] DNS conflict. Remove the conflicting record and retry.");
    await expect(runDeploy({
      projectRoot, loadConfig: async () => appConfig, getAccess: fakeAccess, build: async () => {},
      stdout: { write() {} }, deploy,
      inspectAppDomain: async () => ({ name: appConfig.domain, worker: appConfig.name, action: "connect", otherDomains: [], warnings: [] }),
      provisionAppDomain: async () => { throw cause; },
    })).rejects.toThrow(/\[Goribu\] Worker app was deployed.*app.example.com could not be confirmed.*rerun `goribu deploy`.*DNS conflict/);
    expect(deploy).toHaveBeenCalledOnce();
  });

  it("rejects duplicate R2 ownership before authentication, build, or deployment", async () => {
    const projectRoot = makeProject();
    const appConfig = defineConfig({ name: "app", compatibilityDate: "2026-09-01", r2: { name: "app-files" } });
    writeFileSync(join(projectRoot, "wrangler.jsonc"), '{"r2_buckets":[]}');
    const build = vi.fn();
    const getAccess = vi.fn();
    const deploy = vi.fn();
    await expect(runDeploy({ projectRoot, loadConfig: async () => appConfig, build, getAccess, deploy }))
      .rejects.toThrow(/Remove the r2_buckets declaration/);
    expect(build).not.toHaveBeenCalled();
    expect(getAccess).not.toHaveBeenCalled();
    expect(deploy).not.toHaveBeenCalled();
  });

  it("rejects duplicate Hyperdrive ownership before authentication, build, or deployment", async () => {
    const projectRoot = makeProject();
    const appConfig = defineConfig({ name: "app", compatibilityDate: "2026-09-01", database: { type: "postgres" } });
    writeFileSync(join(projectRoot, "wrangler.jsonc"), '{"hyperdrive":[]}');
    const build = vi.fn();
    const getAccess = vi.fn();
    const deploy = vi.fn();
    await expect(runDeploy({ projectRoot, loadConfig: async () => appConfig, build, getAccess, deploy }))
      .rejects.toThrow(/Remove the hyperdrive entry.*set hyperdriveId and hyperdriveCachedId/);
    expect(build).not.toHaveBeenCalled();
    expect(getAccess).not.toHaveBeenCalled();
    expect(deploy).not.toHaveBeenCalled();
  });

  it("guards and authenticates before building, then provisions, finalizes, migrates, and deploys", async () => {
    const events = [];
    const appConfig = defineConfig({
      name: "app",
      compatibilityDate: "2026-09-03",
      database: { type: "d1", name: "app-db" },
    });
    const database = { name: "app-db", uuid: "database-id" };
    const guard = vi.fn(async () => events.push("guard"));
    const guardHyperdrive = vi.fn(async () => events.push("guard-hyperdrive"));
    const provision = vi.fn(async () => {
      events.push("provision");
      return database;
    });
    const build = vi.fn(async () => events.push("build"));
    const migrate = vi.fn(async () => events.push("migrate"));
    const finalize = vi.fn(() => events.push("finalize"));
    const deploy = vi.fn(async () => {
      events.push("deploy");
      return 0;
    });

    await expect(
      runDeploy({
        projectRoot: "/app",
        build,
        loadConfig: async () => appConfig,
        guard,
        guardHyperdrive,
        getAccess: async () => {
          events.push("auth");
          return fakeAccess();
        },
        provision,
        migrate,
        finalize,
        deploy,
        stdout: { write() {} },
      }),
    ).resolves.toBe(0);
    expect(events).toEqual([
      "guard",
      "guard-hyperdrive",
      "auth",
      "build",
      "provision",
      "finalize",
      "migrate",
      "deploy",
    ]);
    expect(guard).toHaveBeenCalledWith({ projectRoot: "/app", appConfig });
    expect(guardHyperdrive).toHaveBeenCalledWith({ projectRoot: "/app", appConfig });
    expect(migrate).toHaveBeenCalledWith({
      projectRoot: "/app",
      target: "remote",
      loadConfig: expect.any(Function),
      errorLabel: "goribu deploy",
      stdout: expect.any(Object),
    });
    await expect(migrate.mock.calls[0][0].loadConfig()).resolves.toBe(appConfig);
    expect(finalize).toHaveBeenCalledWith({
      projectRoot: "/app",
      appConfig,
      database,
    });
  });

  it("does not upload the Worker when a production migration fails", async () => {
    const appConfig = defineConfig({
      name: "app",
      compatibilityDate: "2026-09-03",
      database: { type: "d1", name: "app-db" },
    });
    const migrationError = new Error("migration failed");
    const finalize = vi.fn();
    const deploy = vi.fn();

    await expect(
      runDeploy({
        projectRoot: "/app",
        build: async () => {},
        loadConfig: async () => appConfig,
        guard: async () => {},
        getAccess: fakeAccess,
        provision: async () => ({ name: "app-db", uuid: "database-id" }),
        migrate: async () => {
          throw migrationError;
        },
        finalize,
        deploy,
      }),
    ).rejects.toBe(migrationError);
    expect(finalize).toHaveBeenCalledOnce();
    expect(deploy).not.toHaveBeenCalled();
  });

  it("does not migrate or upload when the built binding cannot be finalized", async () => {
    const appConfig = defineConfig({
      name: "app",
      compatibilityDate: "2026-09-03",
      database: { type: "d1", name: "app-db" },
    });
    const migrate = vi.fn();
    const deploy = vi.fn();

    await expect(
      runDeploy({
        projectRoot: "/app",
        build: async () => {},
        loadConfig: async () => appConfig,
        guard: async () => {},
        getAccess: fakeAccess,
        provision: async () => ({ name: "app-db", uuid: "database-id" }),
        finalize: () => {
          throw new Error("invalid deploy artifact");
        },
        migrate,
        deploy,
      }),
    ).rejects.toThrow(/invalid deploy artifact/);
    expect(migrate).not.toHaveBeenCalled();
    expect(deploy).not.toHaveBeenCalled();
  });

  it("does not mutate remote state when local validation or build fails", async () => {
    const appConfig = defineConfig({
      name: "app",
      compatibilityDate: "2026-09-03",
      database: { type: "d1", name: "app-db" },
    });
    const build = vi.fn();
    const provision = vi.fn();
    const deploy = vi.fn();
    const getAccess = vi.fn(fakeAccess);

    await expect(
      runDeploy({
        projectRoot: "/app",
        build,
        getAccess,
        loadConfig: async () => appConfig,
        guard: async () => {
          throw new Error("duplicate d1_databases");
        },
        provision,
        deploy,
      }),
    ).rejects.toThrow(/duplicate d1_databases/);
    expect(build).not.toHaveBeenCalled();
    expect(getAccess).not.toHaveBeenCalled();
    expect(provision).not.toHaveBeenCalled();
    expect(deploy).not.toHaveBeenCalled();

    await expect(
      runDeploy({
        projectRoot: "/app",
        build: async () => {
          throw new Error("build failed");
        },
        loadConfig: async () => appConfig,
        guard: async () => {},
        getAccess,
        provision,
        deploy,
      }),
    ).rejects.toThrow(/build failed/);
    expect(getAccess).toHaveBeenCalledOnce();
    expect(provision).not.toHaveBeenCalled();
    expect(deploy).not.toHaveBeenCalled();
  });

  it("authenticates, builds, and deploys without resource work when no resources are declared", async () => {
    const appConfig = defineConfig({
      name: "app",
      compatibilityDate: "2026-09-03",
    });
    const finalize = vi.fn();
    const migrate = vi.fn();
    const deploy = vi.fn(async () => 0);
    const getAccess = vi.fn(fakeAccess);

    await runDeploy({
      projectRoot: "/app",
      build: async () => {},
      getAccess,
      loadConfig: async () => appConfig,
      provision: async () => null,
      migrate,
      finalize,
      deploy,
    });

    expect(migrate).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
    expect(getAccess).toHaveBeenCalledWith({ projectRoot: "/app" });
    expect(deploy).toHaveBeenCalledWith({ projectRoot: "/app", secretsFile: undefined, accountId: "account" });
  });

  it("stops before building or remote mutations when authentication fails, even without resources", async () => {
    const build = vi.fn();
    const provision = vi.fn();
    const provisionKV = vi.fn();
    const migrate = vi.fn();
    const deploy = vi.fn();
    const failure = new Error("[Goribu] Wrangler is not authenticated. Run `goribu cloudflare-login`.");

    await expect(runDeploy({
      projectRoot: "/app",
      loadConfig: async () => defineConfig({ name: "app", compatibilityDate: "2026-09-05" }),
      getAccess: async () => { throw failure; },
      build, provision, provisionKV, migrate, deploy,
    })).rejects.toBe(failure);

    for (const stage of [build, provision, provisionKV, migrate, deploy]) {
      expect(stage).not.toHaveBeenCalled();
    }
  });
});

it("finalizes the R2 account after build and before validation or remote mutation", async () => {
  const projectRoot = makeProject();
  writeFileSync(join(projectRoot, ".env.production"), "EXAMPLE=test-only\n");
  const appConfig = defineConfig({ name: "app", compatibilityDate: "2026-09-01", r2: { name: "app-files" } });
  const events = [];
  const accountId = "b".repeat(32);
  const finalizeR2Account = vi.fn(() => events.push("account"));
  const options = {
    projectRoot, loadConfig: async () => appConfig,
    getAccess: async () => ({ accountId, headers: {} }),
    build: async () => { events.push("build"); }, finalizeR2Account,
    validateSecrets: async () => { events.push("validate"); },
    provisionR2: async () => { events.push("r2"); return null; },
    ensureR2SigningSecret: async () => { events.push("secret"); },
    provision: async () => { events.push("provision"); return null; },
    provisionKV: async () => null,
    deploy: async () => { events.push("deploy"); return 0; },
    stdout: { write() {} },
  };
  await runDeploy(options);
  expect(events).toEqual(["build", "account", "validate", "r2", "provision", "secret", "deploy"]);
  expect(finalizeR2Account).toHaveBeenCalledWith({ projectRoot, appConfig, accountId });
  events.length = 0;
  finalizeR2Account.mockImplementation(() => { throw new Error("invalid artifact"); });
  await expect(runDeploy(options)).rejects.toThrow("invalid artifact");
  expect(events).toEqual(["build"]);
});

it("creates the R2 secret after migrations and stops the upload if secret setup fails", async () => {
  const projectRoot = makeProject();
  const appConfig = defineConfig({ name: "app", compatibilityDate: "2026-09-01", r2: { name: "app-files" }, database: { type: "d1", name: "app-db" } });
  const events = [];
  const access = { accountId: "a".repeat(32), headers: {} };
  const ensureR2SigningSecret = vi.fn(async () => { events.push("secret"); });
  const options = {
    projectRoot, loadConfig: async () => appConfig, getAccess: async () => access,
    stdout: { write() {} }, build: async () => {}, finalizeR2Account() {},
    provisionR2: async () => { events.push("r2"); },
    provision: async () => ({ uuid: "db-id" }), finalize() {},
    migrate: async () => { events.push("migrate"); }, ensureR2SigningSecret,
    deploy: vi.fn(async () => { events.push("deploy"); return 0; }),
  };
  await runDeploy(options);
  expect(events).toEqual(["r2", "migrate", "secret", "deploy"]);
  expect(ensureR2SigningSecret.mock.calls[0][0].access).toBe(access);

  // Missing upload keys are asked for after the buckets, migrations and the
  // signing secret, and an unconfirmed key stops the upload.
  events.length = 0;
  const uploads = { keys: "missing", missingKeys: ["R2_ACCESS_KEY_ID"], cors: [] };
  options.provisionR2 = vi.fn(async () => { events.push("r2"); return { uploads }; });
  options.ensureR2UploadKeys = vi.fn(async () => { events.push("keys"); });
  options.canPrompt = true;
  await runDeploy(options);
  expect(events).toEqual(["r2", "migrate", "secret", "keys", "deploy"]);
  expect(options.provisionR2.mock.calls[0][0].canPrompt).toBe(true);
  expect(options.ensureR2UploadKeys.mock.calls[0][0]).toMatchObject({ access, uploads });
  options.deploy.mockClear();
  options.ensureR2UploadKeys.mockImplementation(async () => { throw new Error("key setup failed"); });
  await expect(runDeploy(options)).rejects.toThrow("key setup failed");
  expect(options.deploy).not.toHaveBeenCalled();
  options.deploy.mockClear();
  ensureR2SigningSecret.mockImplementation(async () => { throw new Error("secret setup failed"); });
  await expect(runDeploy(options)).rejects.toThrow("secret setup failed");
  expect(options.deploy).not.toHaveBeenCalled();
  ensureR2SigningSecret.mockClear();
  options.migrate = async () => { throw new Error("migration failed"); };
  await expect(runDeploy(options)).rejects.toThrow("migration failed");
  expect(ensureR2SigningSecret).not.toHaveBeenCalled();
});

it("validates production secrets before provisioning, and never uploads the local .env as fallback", async () => {
  const projectRoot = makeProject();
  writeFileSync(join(projectRoot, ".env"), "LOCAL_ONLY=never-upload\n");
  const stdout = { write: vi.fn() };
  const provision = vi.fn(async () => null);
  const provisionKV = vi.fn(async () => null);
  const migrate = vi.fn();
  const deploy = vi.fn(async () => 0);
  const validateSecrets = vi.fn(async () => {});
  const options = {
    projectRoot, stdout, provision, provisionKV, migrate, deploy, validateSecrets,
    build: async () => {}, getAccess: fakeAccess,
    loadConfig: async () => defineConfig({ name: "app", compatibilityDate: "2026-09-11" }),
  };
  await runDeploy(options);
  expect(validateSecrets).not.toHaveBeenCalled();
  expect(deploy).toHaveBeenLastCalledWith({ projectRoot, secretsFile: undefined, accountId: "account" });
  expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining("use existing platform secrets"));

  writeFileSync(join(projectRoot, ".env.production"), "PROD_ONLY=upload\nPUBLIC_NAME=public-too\n");
  await runDeploy(options);
  expect(validateSecrets).toHaveBeenCalledWith({ projectRoot, secretsFile: ".env.production", accountId: "account" });
  expect(deploy).toHaveBeenLastCalledWith({ projectRoot, secretsFile: ".env.production", accountId: "account" });
  expect(stdout.write.mock.calls.flat().join("")).not.toMatch(/PROD_ONLY|PUBLIC_NAME|never-upload/);

  for (const stage of [provision, provisionKV, migrate, deploy]) stage.mockClear();
  validateSecrets.mockRejectedValueOnce(new Error("invalid production secrets"));
  await expect(runDeploy(options)).rejects.toThrow("invalid production secrets");
  for (const stage of [provision, provisionKV, migrate, deploy]) expect(stage).not.toHaveBeenCalled();
});
