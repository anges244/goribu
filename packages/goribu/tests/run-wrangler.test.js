import { spawn as nodeSpawn } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { runWrangler } from "../src/build/run-wrangler.js";

const accountId = "a".repeat(32);

it("runs the bundled Wrangler in the app with the deploy account and keeps its exit status", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "goribu-wrangler-"));
  const bin = join(projectRoot, "fake-wrangler.cjs");
  writeFileSync(bin, `
    const { realpathSync } = require("node:fs");
    if (realpathSync(process.cwd()) !== ${JSON.stringify(realpathSync(projectRoot))}) process.exit(90);
    if (process.env.CLOUDFLARE_ACCOUNT_ID !== ${JSON.stringify(accountId)}) process.exit(91);
    process.exit(Number(process.argv.at(-1)));
  `);
  try {
    const getAccess = vi.fn(async () => ({ accountId }));
    for (const code of ["0", "3"]) {
      const args = ["r2", "bucket", "dev-url", "disable", "app-files", "-J", "eu", code];
      const spawn = vi.fn(nodeSpawn);
      await expect(runWrangler({ projectRoot, args, spawn, getAccess, resolveBin: () => bin })).resolves.toBe(Number(code));
      expect(spawn.mock.calls[0][1]).toEqual([bin, ...args]);
      expect(spawn.mock.calls[0][2].stdio).toEqual(["inherit", "inherit", "pipe"]);
    }
    // Account errors name this command, not deploy.
    expect(getAccess).toHaveBeenCalledWith({ projectRoot, command: "goribu wrangler" });
    await expect(runWrangler({ projectRoot, args: ["deploy", "--dry-run", "0"], getAccess, resolveBin: () => bin })).resolves.toBe(0);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

it("refuses a real deploy and an empty command before reaching Cloudflare", async () => {
  const getAccess = vi.fn();
  const spawn = vi.fn();
  await expect(runWrangler({ projectRoot: "/app", args: ["deploy"], getAccess, spawn }))
    .rejects.toThrow("[Goribu] `goribu wrangler deploy` would skip Goribu's build, provisioning and migrations. Run `goribu deploy` instead");
  await expect(runWrangler({ projectRoot: "/app", args: [], getAccess, spawn }))
    .rejects.toThrow("`goribu wrangler` needs a Wrangler command");
  expect(getAccess).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled();
});
