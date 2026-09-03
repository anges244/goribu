import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import {
  createCheckPlan,
  formatCheckPlan,
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
        { name: "goribu-site-db", uuid: "database-id", ignored: true },
      ]),
    });

    await expect(
      listRemoteD1Databases({
        projectRoot: "/app",
        spawn,
        resolveBin: () => "/framework/wrangler.js",
      }),
    ).resolves.toEqual([{ name: "goribu-site-db", uuid: "database-id" }]);
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
});
