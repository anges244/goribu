import { describe, expect, it, vi } from "vitest";
import { defineConfig } from "../src/runtime/application-config.js";
import { runD1 } from "../src/build/run-d1.js";

const appConfig = defineConfig({
  name: "app",
  compatibilityDate: "2026-09-03",
  database: { type: "d1", name: "app-db" },
});

function setup() {
  const projectRoot = "/tmp/goribu-run-d1";
  const loadConfig = vi.fn(async () => appConfig);
  const execute = vi.fn(async () => undefined);
  return { projectRoot, loadConfig, execute };
}

describe("runD1", () => {
  it("runs SQL on the local database dev and migrate share, without asking", async () => {
    const options = setup();
    const ask = vi.fn();
    await runD1({ ...options, sql: "DELETE FROM posts", ask });

    expect(ask).not.toHaveBeenCalled();
    expect(options.execute).toHaveBeenCalledWith(expect.objectContaining({
      target: "local",
      command: "DELETE FROM posts",
      adHoc: true,
      configPath: "/tmp/goribu-run-d1/.goribu/migrate.wrangler.json",
      persistTo: "/tmp/goribu-run-d1/.wrangler/state",
    }));
  });

  it("runs a single remote SELECT without asking", async () => {
    const options = setup();
    const ask = vi.fn();
    await runD1({ ...options, target: "remote", sql: "  select count(*) from posts; ", canPrompt: false, ask });
    expect(ask).not.toHaveBeenCalled();
    expect(options.execute).toHaveBeenCalledWith(expect.objectContaining({ target: "remote" }));
  });

  it.each([
    ["a write", "DELETE FROM posts"],
    ["a second statement after a SELECT", "SELECT 1; DELETE FROM posts"],
    ["a CTE, which can wrap a write", "WITH x AS (SELECT 1) DELETE FROM posts"],
  ])("refuses %s on production without a terminal, before loading config", async (_label, sql) => {
    const options = setup();
    await expect(runD1({ ...options, target: "remote", sql, canPrompt: false })).rejects.toThrow(
      /only a single SELECT without confirmation[\s\S]*goribu migrate:new <name>[\s\S]*Nothing was run\./,
    );
    expect(options.loadConfig).not.toHaveBeenCalled();
    expect(options.execute).not.toHaveBeenCalled();
  });

  it("runs a production write only when the database name is typed", async () => {
    const declined = setup();
    for (const answer of ["yes", null]) {
      await expect(
        runD1({ ...declined, target: "remote", sql: "DELETE FROM posts", canPrompt: true, ask: async () => answer }),
      ).rejects.toThrow(/did not match "app-db", so nothing was run/);
    }
    expect(declined.execute).not.toHaveBeenCalled();

    const confirmed = setup();
    const ask = vi.fn(async () => "app-db\n");
    await runD1({ ...confirmed, target: "remote", sql: "DELETE FROM posts", canPrompt: true, ask });
    expect(ask.mock.calls[0][0]).toMatch(/D1 database "app-db":\n {2}DELETE FROM posts\n[\s\S]*Type "app-db" to run it: $/);
    expect(confirmed.execute).toHaveBeenCalledWith(expect.objectContaining({ target: "remote", command: "DELETE FROM posts" }));
  });
});
