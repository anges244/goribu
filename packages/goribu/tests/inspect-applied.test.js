import { describe, expect, it } from "vitest";
import { readAppliedMigrations } from "../src/build/migrations/inspect-applied.js";

const shared = { projectRoot: "/app", configPath: "/app/.goribu/migrate.wrangler.json", database: "DB", target: "remote" };

function fakeExecute(responses) {
  const calls = [];
  const execute = async (options) => {
    calls.push(options);
    if (typeof options.command === "string" && options.command.includes("sqlite_master")) {
      return [{ results: responses.tableRows, success: true }];
    }
    return [{ results: responses.appliedRows ?? [], success: true }];
  };
  execute.calls = calls;
  return execute;
}

describe("readAppliedMigrations", () => {
  it("checks sqlite_master first, then reads the ledger rows in order", async () => {
    const execute = fakeExecute({
      tableRows: [{ name: "_goribu_migrations" }],
      appliedRows: [{ name: "0001_a", checksum: "aa" }, { name: "0002_b", checksum: "bb" }],
    });

    const rows = await readAppliedMigrations({ execute, shared });

    expect(rows).toEqual([
      { name: "0001_a", checksum: "aa" },
      { name: "0002_b", checksum: "bb" },
    ]);
    expect(execute.calls[0].command).toContain("sqlite_master");
    expect(execute.calls[1].command).toContain("SELECT name, checksum");
    expect(execute.calls.every((call) => call.json === true)).toBe(true);
  });

  it("returns no rows and never queries the ledger when the table does not exist", async () => {
    const execute = fakeExecute({ tableRows: [] });

    const rows = await readAppliedMigrations({ execute, shared });

    expect(rows).toEqual([]);
    expect(execute.calls).toHaveLength(1);
  });

  it("coerces row fields to strings", async () => {
    const execute = fakeExecute({
      tableRows: [{ name: "_goribu_migrations" }],
      appliedRows: [{ name: 1, checksum: 2 }],
    });

    const rows = await readAppliedMigrations({ execute, shared });

    expect(rows).toEqual([{ name: "1", checksum: "2" }]);
  });
});
