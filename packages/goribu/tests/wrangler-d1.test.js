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

  it("requires exactly one of file or command", async () => {
    await expect(executeD1({ ...base, spawn: fakeSpawn() })).rejects.toThrow(
      /exactly one of file or command/,
    );
  });
});
