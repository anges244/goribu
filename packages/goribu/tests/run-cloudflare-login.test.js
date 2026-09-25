import { spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { runCloudflareLogin } from "../src/build/run-cloudflare-login.js";

it("runs login in the calling directory without requiring app config and preserves Wrangler's exit status", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "goribu-login-"));
  const bin = join(projectRoot, "fake-wrangler.cjs");
  writeFileSync(bin, `
    const assert = require("node:assert/strict");
    assert.deepEqual(process.argv.slice(2), ["login"]);
    assert.equal(require("node:fs").realpathSync(process.cwd()), require("node:fs").realpathSync(__dirname));
    process.exit(Number(process.env.GORIBU_TEST_LOGIN_EXIT));
  `);
  try {
    for (const code of [0, 2]) {
      const spawn = vi.fn((command, args, options) => nodeSpawn(command, args, {
        ...options,
        env: { ...process.env, GORIBU_TEST_LOGIN_EXIT: String(code) },
      }));
      await expect(runCloudflareLogin({ projectRoot, spawn, resolveBin: () => bin })).resolves.toBe(code);
      expect(spawn).toHaveBeenCalledWith(process.execPath, [bin, "login"], {
        cwd: projectRoot,
        stdio: ["inherit", "inherit", "pipe"],
      });
    }
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

it("explains how to repair resolution and launch failures", async () => {
  const cause = new Error("unavailable executable");
  const spawn = vi.fn();
  await expect(runCloudflareLogin({
    projectRoot: "/app", spawn, resolveBin: () => { throw cause; },
  })).rejects.toThrow(/\[Goribu\].*Could not find Wrangler.*pnpm install.*goribu cloudflare-login/);
  expect(spawn).not.toHaveBeenCalled();

  for (const fail of [
    () => { throw cause; },
    () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("error", cause));
      return child;
    },
  ]) {
    await expect(runCloudflareLogin({
      projectRoot: "/app", spawn: fail, resolveBin: () => "/missing/wrangler.js",
    })).rejects.toThrow(/\[Goribu\].*Could not run Wrangler.*goribu cloudflare-login/);
  }
});

it("does not report success when Wrangler terminates without an exit code", async () => {
  for (const signal of ["SIGTERM", null]) {
    const spawn = () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("close", null, signal));
      return child;
    };
    const result = runCloudflareLogin({ projectRoot: "/app", spawn, resolveBin: () => "/wrangler.js" });
    if (signal) {
      await expect(result).rejects.toThrow(/\[Goribu\].*signal SIGTERM.*goribu cloudflare-login/);
    } else {
      await expect(result).resolves.toBe(1);
    }
  }
});
