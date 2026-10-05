import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { executeD1, lastResultRows } from "../src/build/migrations/wrangler-d1.js";

// A spawn stand-in that emits scripted stdout then closes with a code.
function fakeSpawn({ output = "", code = 0, signal = null } = {}) {
  const calls = [];
  function spawn(command, args, options) {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    queueMicrotask(() => {
      if (output !== "") child.stdout.emit("data", output);
      child.emit("close", code, signal);
    });
    return child;
  }
  spawn.calls = calls;
  return spawn;
}

const base = {
  projectRoot: "/app",
  configPath: "/app/.goribu/migrate.wrangler.json",
  database: "DB",
  target: "local",
  persistTo: "/app/.wrangler/state",
  resolveBin: () => "/fake/wrangler.js",
};

describe("executeD1", () => {
  it("builds the local file-mutation invocation", async () => {
    const spawn = fakeSpawn();
    await executeD1({ ...base, file: "/tmp/m.sql", spawn });

    expect(spawn.calls[0].args).toEqual([
      "/fake/wrangler.js",
      "d1",
      "execute",
      "DB",
      "--local",
      "--config",
      "/app/.goribu/migrate.wrangler.json",
      "-y",
      "--persist-to",
      "/app/.wrangler/state",
      "--file",
      "/tmp/m.sql",
    ]);
    expect(spawn.calls[0].options.cwd).toBe("/app");
  });

  it("returns and validates the successful result-array shape", async () => {
    const spawn = fakeSpawn({
      output: JSON.stringify([{ results: [{ a: 1 }], success: true, meta: {} }]),
    });
    const result = await executeD1({ ...base, command: "SELECT 1", json: true, spawn });
    expect(lastResultRows(result)).toEqual([{ a: 1 }]);
  });

  it.each([
    ["an object", "{}"],
    ["an empty array", "[]"],
    ["a result without results", JSON.stringify([{ success: true }])],
    ["an unsuccessful result", JSON.stringify([{ results: [], success: false }])],
  ])("fails closed on %s rather than reading it as empty rows", async (_label, output) => {
    const spawn = fakeSpawn({ output });
    await expect(
      executeD1({ ...base, command: "SELECT 1", json: true, spawn }),
    ).rejects.toThrow(/unexpected D1 result shape/);
  });

  it("throws a teaching error on unreadable JSON", async () => {
    const spawn = fakeSpawn({ output: "not json" });
    await expect(
      executeD1({ ...base, command: "SELECT 1", json: true, spawn }),
    ).rejects.toThrow(/unreadable JSON/);
  });

  it("fails closed when Wrangler exits non-zero", async () => {
    const spawn = fakeSpawn({ code: 1 });
    await expect(
      executeD1({ ...base, command: "SELECT 1", json: true, spawn }),
    ).rejects.toThrow(/Wrangler could not run the local D1 SQL/);
  });

  it("labels failures for the calling command and reassures a read-only caller", async () => {
    await expect(
      executeD1({
        ...base,
        command: "SELECT 1",
        json: true,
        spawn: fakeSpawn({ code: 1 }),
        errorLabel: "goribu check",
        readOnly: true,
      }),
    ).rejects.toThrow(/for `goribu check`[\s\S]*No resources were changed\./);

    // The default keeps the migrate-specific wording every migrate command relies on.
    await expect(
      executeD1({ ...base, command: "SELECT 1", json: true, spawn: fakeSpawn({ code: 1 }) }),
    ).rejects.toThrow(/for `goribu migrate`[\s\S]*No migration was recorded/);
  });

  it("reassures a read-only caller when Wrangler is missing or returns unreadable JSON", async () => {
    await expect(
      executeD1({
        ...base,
        command: "SELECT 1",
        json: true,
        resolveBin: () => {
          throw new Error("not found");
        },
        errorLabel: "goribu check",
        readOnly: true,
      }),
    ).rejects.toThrow(/which `goribu check` uses[\s\S]*No resources were changed\./);

    await expect(
      executeD1({
        ...base,
        command: "SELECT 1",
        json: true,
        spawn: fakeSpawn({ output: "not json" }),
        errorLabel: "goribu check",
        readOnly: true,
      }),
    ).rejects.toThrow(/unreadable JSON while `goribu check`[\s\S]*No resources were changed\./);
  });

  it("lets Wrangler print ad-hoc results and claims nothing about a failed ad-hoc run", async () => {
    const spawn = fakeSpawn();
    await executeD1({ ...base, command: "SELECT 1", adHoc: true, spawn });
    expect(spawn.calls[0].options.stdio).toEqual(["ignore", "inherit", "pipe"]);

    const failure = executeD1({ ...base, command: "DELETE FROM t", adHoc: true, errorLabel: "goribu d1", spawn: fakeSpawn({ code: 1 }) });
    await expect(failure).rejects.toThrow(/for `goribu d1`[\s\S]*Then rerun the command\.$/);
  });

  it("requires exactly one of file or command", async () => {
    await expect(executeD1({ ...base, spawn: fakeSpawn() })).rejects.toThrow(
      /exactly one of file or command/,
    );
  });
});
