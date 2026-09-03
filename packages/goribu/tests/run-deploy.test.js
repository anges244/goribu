import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import {
  resolveWranglerBin,
  runDeploy,
  runWranglerDeploy,
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

describe("runWranglerDeploy", () => {
  it("launches the resolved Wrangler binary with deploy in the project root", async () => {
    const spawn = fakeSpawn((child) => child.emit("close", 0, null));

    const code = await runWranglerDeploy({ projectRoot: "/app", spawn, resolveBin });

    expect(code).toBe(0);
    expect(spawn.calls).toHaveLength(1);
    expect(spawn.calls[0]).toEqual({
      command: process.execPath,
      args: [FAKE_BIN, "deploy"],
      options: { cwd: "/app", stdio: "inherit" },
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
  it("guards and builds before provisioning, then finalizes and deploys", async () => {
    const events = [];
    const appConfig = defineConfig({
      name: "app",
      compatibilityDate: "2026-09-03",
      database: { type: "d1", name: "app-db" },
    });
    const database = { name: "app-db", uuid: "database-id" };
    const guard = vi.fn(async () => events.push("guard"));
    const provision = vi.fn(async () => {
      events.push("provision");
      return database;
    });
    const build = vi.fn(async () => events.push("build"));
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
        provision,
        finalize,
        deploy,
        stdout: { write() {} },
      }),
    ).resolves.toBe(0);
    expect(events).toEqual(["guard", "build", "provision", "finalize", "deploy"]);
    expect(guard).toHaveBeenCalledWith({ projectRoot: "/app", appConfig });
    expect(finalize).toHaveBeenCalledWith({
      projectRoot: "/app",
      appConfig,
      database,
    });
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

    await expect(
      runDeploy({
        projectRoot: "/app",
        build,
        loadConfig: async () => appConfig,
        guard: async () => {
          throw new Error("duplicate d1_databases");
        },
        provision,
        deploy,
      }),
    ).rejects.toThrow(/duplicate d1_databases/);
    expect(build).not.toHaveBeenCalled();
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
        provision,
        deploy,
      }),
    ).rejects.toThrow(/build failed/);
    expect(provision).not.toHaveBeenCalled();
    expect(deploy).not.toHaveBeenCalled();
  });

  it("builds and deploys without resource work when no database is declared", async () => {
    const appConfig = defineConfig({
      name: "app",
      compatibilityDate: "2026-09-03",
    });
    const finalize = vi.fn();
    const deploy = vi.fn(async () => 0);

    await runDeploy({
      projectRoot: "/app",
      build: async () => {},
      loadConfig: async () => appConfig,
      provision: async () => null,
      finalize,
      deploy,
    });

    expect(finalize).not.toHaveBeenCalled();
    expect(deploy).toHaveBeenCalledWith({ projectRoot: "/app" });
  });
});
