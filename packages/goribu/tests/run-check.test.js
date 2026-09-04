import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import {
  createCheckPlan,
  formatCheckPlan,
  inspectRemoteMigrations,
  listRemoteD1Databases,
  runCheck,
} from "../src/build/run-check.js";

const appConfig = defineConfig({
  name: "goribu-site",
  compatibilityDate: "2026-09-03",
  compatibilityFlags: ["nodejs_compat"],
  database: { type: "d1", name: "goribu-site-db" },
});

function fakeSpawn({ output = "[]", code = 0, signal = null, error } = {}) {
  const calls = [];
  function spawn(command, args, options) {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    queueMicrotask(() => {
      if (error !== undefined) {
        child.emit("error", error);
        return;
      }
      child.stdout.emit("data", output);
      child.emit("close", code, signal);
    });
    return child;
  }
  spawn.calls = calls;
  return spawn;
}

describe("goribu check", () => {
  it("reports a missing D1 database, its future DB binding, target, and cost warning", async () => {
    const written = [];
    const plan = await runCheck({
      projectRoot: "/app",
      loadConfig: vi.fn(async () => appConfig),
      inspectD1: vi.fn(async () => []),
      stdout: { write: (text) => written.push(text) },
    });

    expect(plan.readOnly).toBe(true);
    expect(plan.resources).toEqual([
      {
        kind: "D1 database",
        name: "goribu-site-db",
        state: "missing",
        action: "create",
        id: undefined,
      },
    ]);
    expect(written.join("")).toContain(
      'Missing: D1 database "goribu-site-db"',
    );
    expect(written.join("")).toContain(
      'To create on goribu deploy: D1 database "goribu-site-db"',
    );
    expect(written.join("")).toContain(
      'DB -> D1 database "goribu-site-db"',
    );
    expect(written.join("")).toContain("Worker: goribu-site");
    expect(written.join("")).toContain("Environment: production");
    expect(written.join("")).toContain("D1 reads, writes, and storage");
    expect(written.join("")).toMatch(/No changes were made\.\n$/);
  });

  it("reports an existing D1 database without planning creation", () => {
    const plan = createCheckPlan({
      appConfig,
      remoteDatabases: [{ name: "goribu-site-db", uuid: "database-id" }],
    });
    const output = formatCheckPlan(plan);

    expect(plan.resources[0]).toMatchObject({
      state: "existing",
      action: "none",
      id: "database-id",
    });
    expect(output).toContain(
      'Existing: D1 database "goribu-site-db" (database-id)',
    );
    expect(output).toContain("Missing: none");
    expect(output).toContain("To create on goribu deploy: none");
  });

  it("uses pinned Wrangler's read-only JSON list and validates its response", async () => {
    const spawn = fakeSpawn({
      output: JSON.stringify([
        {
          name: "goribu-site-db",
          uuid: "database-id",
          read_replication: { mode: "auto" },
          ignored: true,
        },
      ]),
    });

    await expect(
      listRemoteD1Databases({
        projectRoot: "/app",
        spawn,
        resolveBin: () => "/framework/wrangler.js",
      }),
    ).resolves.toEqual([
      {
        name: "goribu-site-db",
        uuid: "database-id",
        readReplication: "auto",
      },
    ]);
    expect(spawn.calls).toEqual([
      {
        command: process.execPath,
        args: ["/framework/wrangler.js", "d1", "list", "--json"],
        options: {
          cwd: "/app",
          stdio: ["ignore", "pipe", "inherit"],
        },
      },
    ]);
  });

  it("fails closed when remote inspection is ambiguous or Wrangler fails", async () => {
    expect(() =>
      createCheckPlan({
        appConfig,
        remoteDatabases: [
          { name: "goribu-site-db", uuid: "first" },
          { name: "goribu-site-db", uuid: "second" },
        ],
      }),
    ).toThrow(/cannot choose safely.*No resources were changed/);

    await expect(
      listRemoteD1Databases({
        projectRoot: "/app",
        spawn: fakeSpawn({ code: 1 }),
        resolveBin: () => "/framework/wrangler.js",
      }),
    ).rejects.toThrow(/Wrangler finished with exit code 1.*No resources were changed/);

    await expect(
      listRemoteD1Databases({
        projectRoot: "/app",
        spawn: fakeSpawn({ output: "not json" }),
        resolveBin: () => "/framework/wrangler.js",
      }),
    ).rejects.toThrow(/Wrangler returned invalid JSON.*No resources were changed/);

    await expect(
      listRemoteD1Databases({
        projectRoot: "/app",
        spawn: fakeSpawn({ error: new Error("spawn failed") }),
        resolveBin: () => "/framework/wrangler.js",
      }),
    ).rejects.toThrow(/\[Goribu\] Could not start Wrangler.*No resources were changed/);
  });

  it("skips remote inspection when no database is declared", async () => {
    const inspectD1 = vi.fn();
    const config = defineConfig({
      name: "plain-app",
      compatibilityDate: "2026-09-03",
    });
    const output = [];

    await runCheck({
      projectRoot: "/app",
      loadConfig: async () => config,
      inspectD1,
      stdout: { write: (text) => output.push(text) },
    });

    expect(inspectD1).not.toHaveBeenCalled();
    expect(output.join("")).toContain("Resources\n  Existing: none");
    expect(output.join("")).toContain("Bindings\n  none");
    expect(output.join("")).toContain("Cost warnings\n  none");
  });

  it("renders a Migrations block reading none when no database is declared", () => {
    const config = defineConfig({ name: "plain-app", compatibilityDate: "2026-09-03" });
    const output = formatCheckPlan(createCheckPlan({ appConfig: config, remoteDatabases: [] }));

    expect(output).toContain("Migrations (production)\n  none (no database declared)");
  });
});

describe("goribu check — production migration status", () => {
  const remote = [{ name: "goribu-site-db", uuid: "database-id" }];
  const migrations = [
    { name: "0001_a", sequence: 1, checksum: "aa" },
    { name: "0002_b", sequence: 2, checksum: "bb" },
  ];

  it("splits applied and pending against the production ledger and warns deploy will not apply", () => {
    const plan = createCheckPlan({
      appConfig,
      remoteDatabases: remote,
      migrations,
      appliedRows: [{ name: "0001_a", checksum: "aa" }],
    });

    expect(plan.migrations).toEqual({
      declared: true,
      databaseExists: true,
      defined: 2,
      applied: ["0001_a"],
      pending: ["0002_b"],
      drift: [],
    });

    const output = formatCheckPlan(plan);
    expect(output).toContain("Migrations (production)");
    expect(output).toContain("Defined: 2");
    expect(output).toContain("Applied: 1");
    expect(output).toContain("Pending: 1");
    expect(output).toContain("- 0002_b");
    expect(output).toContain(
      "goribu deploy will verify migration history and apply pending migrations before uploading the Worker.",
    );
  });

  it("reports drift as information without throwing", () => {
    const plan = createCheckPlan({
      appConfig,
      remoteDatabases: remote,
      migrations: [{ name: "0001_a", sequence: 1, checksum: "new" }],
      appliedRows: [{ name: "0001_a", checksum: "old" }],
    });

    expect(plan.migrations.drift).toEqual([{ name: "0001_a", reason: "modified" }]);
    const output = formatCheckPlan(plan);
    expect(output).toContain("Drift (1):");
    expect(output).toContain("- 0001_a: modified");
    expect(output).toContain("Resolve drift before migrating");
    expect(output).toContain("goribu deploy will refuse this drift before uploading the Worker.");
    expect(output).not.toContain("apply pending migrations before uploading");
  });

  it("treats every migration as pending when the database does not exist yet", () => {
    const plan = createCheckPlan({
      appConfig,
      remoteDatabases: [],
      migrations,
      appliedRows: [],
    });

    expect(plan.migrations).toMatchObject({ databaseExists: false, pending: ["0001_a", "0002_b"] });
    const output = formatCheckPlan(plan);
    expect(output).toContain("Applied: unknown (the database does not exist yet)");
    expect(output).toContain("Pending: 2 (all)");
    expect(output).toContain(
      "goribu deploy will create the database, apply pending migrations, and then upload the Worker.",
    );
  });

  it("reads none when a database is declared but no migration files exist", () => {
    const output = formatCheckPlan(
      createCheckPlan({ appConfig, remoteDatabases: remote, migrations: [], appliedRows: [] }),
    );
    expect(output).toContain("Migrations (production)\n  Defined: none");
  });

  it("still renders drift when the ledger has an applied migration whose file was deleted", () => {
    const plan = createCheckPlan({
      appConfig,
      remoteDatabases: remote,
      migrations: [],
      appliedRows: [{ name: "0001_a", checksum: "aa" }],
    });

    expect(plan.migrations).toMatchObject({ defined: 0, drift: [{ name: "0001_a", reason: "missing" }] });
    const output = formatCheckPlan(plan);
    expect(output).toContain("Defined: none");
    expect(output).toContain("Drift (1):");
    expect(output).toContain("- 0001_a: missing");
    expect(output).toContain("Resolve drift before migrating");
    expect(output).toContain("goribu deploy will refuse this drift before uploading the Worker.");
  });

  it("states the deploy/migrate guidance even when production is fully up to date", () => {
    const output = formatCheckPlan(
      createCheckPlan({
        appConfig,
        remoteDatabases: remote,
        migrations: [{ name: "0001_a", sequence: 1, checksum: "aa" }],
        appliedRows: [{ name: "0001_a", checksum: "aa" }],
      }),
    );

    expect(output).toContain("Pending: none");
    expect(output).toContain(
      "goribu deploy will verify migration history and apply pending migrations before uploading the Worker.",
    );
  });

  it("queries the production ledger only when the database exists, reusing the loaded config", async () => {
    const inspectMigrations = vi.fn(async () => [{ name: "0001_a", checksum: "aa" }]);

    await runCheck({
      projectRoot: "/app",
      loadConfig: async () => appConfig,
      inspectD1: async () => remote,
      inspectMigrations,
      stdout: { write() {} },
    });
    expect(inspectMigrations).toHaveBeenCalledTimes(1);
    expect(inspectMigrations).toHaveBeenCalledWith({ projectRoot: "/app", appConfig });

    inspectMigrations.mockClear();
    await runCheck({
      projectRoot: "/app",
      loadConfig: async () => appConfig,
      inspectD1: async () => [],
      inspectMigrations,
      stdout: { write() {} },
    });
    expect(inspectMigrations).not.toHaveBeenCalled();
  });
});

describe("goribu check — migration inspection failures fail closed", () => {
  let root;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "goribu-check-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses to plan when a migration file is malformed", async () => {
    mkdirSync(join(root, "migrations"), { recursive: true });
    writeFileSync(join(root, "migrations", "nope.sql"), "-- migrate:up\n-- migrate:down\n");

    await expect(
      runCheck({
        projectRoot: root,
        loadConfig: async () => appConfig,
        inspectD1: async () => [],
        inspectMigrations: async () => [],
        stdout: { write() {} },
      }),
    ).rejects.toThrow(/does not match the required name/);
  });

  it("inspectRemoteMigrations reads the remote ledger read-only under the check label", async () => {
    const calls = [];
    const execute = async (options) => {
      calls.push(options);
      if (typeof options.command === "string" && options.command.includes("sqlite_master")) {
        return [{ results: [{ name: "_goribu_migrations" }], success: true }];
      }
      return [{ results: [{ name: "0001_a", checksum: "aa" }], success: true }];
    };

    const rows = await inspectRemoteMigrations({ projectRoot: root, appConfig, execute });

    expect(rows).toEqual([{ name: "0001_a", checksum: "aa" }]);
    expect(calls.every((call) => call.target === "remote")).toBe(true);
    expect(calls.every((call) => call.errorLabel === "goribu check" && call.readOnly === true)).toBe(true);
  });
});
