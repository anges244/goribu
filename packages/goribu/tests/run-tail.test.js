import { spawn as nodeSpawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { runTail } from "../src/build/run-tail.js";

const roots = [];
function project() {
  const root = mkdtempSync(join(tmpdir(), "goribu-tail-test-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function options(overrides = {}) {
  let output = "";
  return { projectRoot: "/app", loadConfig: async () => ({ name: "test-app" }),
    resolveBin: () => "/wrangler.js", signals: new EventEmitter(),
    stdout: { isTTY: false },
    stderr: { write(text) { output += text; } }, output: () => output, ...overrides };
}

it("loads the current app name without a build and isolates Wrangler from project config and dotenv files", async () => {
  const projectRoot = project();
  const configModule = new URL("../src/runtime/application-config.js", import.meta.url).href;
  writeFileSync(join(projectRoot, "package.json"), '{"type":"module"}');
  writeFileSync(join(projectRoot, "goribu.config.js"), `import { defineConfig } from ${JSON.stringify(configModule)};
    export default defineConfig({ name: "current-app", compatibilityDate: "2026-10-02" });`);
  writeFileSync(join(projectRoot, "wrangler.json"), '{"name":"stale-worker","account_id":"wrong-account"}');
  writeFileSync(join(projectRoot, ".env"), 'CLOUDFLARE_API_TOKEN=local-not-for-tail');
  const bin = join(projectRoot, "fake-wrangler.cjs");
  writeFileSync(bin, `
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const path = require("node:path");
    const [command, name, configFlag, configPath, envFlag, environment] = process.argv.slice(2);
    assert.equal(command, "tail");
    assert.equal(name, "current-app");
    assert.equal(configFlag, "--config");
    assert.equal(envFlag, "--env");
    assert.equal(environment, "");
    assert.equal(process.env.CLOUDFLARE_ENV, "staging");
    assert.equal(process.env.CLOUDFLARE_API_TOKEN, "shell-test-token");
    assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID, "shell-account");
    assert.equal(fs.realpathSync(process.cwd()), fs.realpathSync(path.dirname(configPath)));
    assert.notEqual(fs.realpathSync(process.cwd()), fs.realpathSync(__dirname));
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath, "utf8")), { name });
    assert.equal(fs.existsSync(".env"), false);
    process.stdout.write("live event\\n");
    process.stderr.write("Run wrangler lo");
    setImmediate(() => {
      process.stderr.write("gin\\n");
      process.exitCode = Number(process.env.GORIBU_TEST_TAIL_EXIT);
    });
  `);
  for (const code of [0, 7]) {
    let workDir, logs = "";
    const opts = options({ projectRoot, loadConfig: undefined, resolveBin: () => bin,
      spawn: (command, args, settings) => {
        expect(settings.stdio).toEqual(["inherit", "inherit", "pipe"]);
        expect(settings.env).toBeUndefined();
        expect(settings.detached).toBe(process.platform !== "win32");
        workDir = settings.cwd;
        const child = nodeSpawn(command, args, { ...settings, stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, CLOUDFLARE_API_TOKEN: "shell-test-token", CLOUDFLARE_ACCOUNT_ID: "shell-account",
            CLOUDFLARE_ENV: "staging", GORIBU_TEST_TAIL_EXIT: String(code) } });
        child.stdout.on("data", (chunk) => { logs += chunk; });
        return child;
      } });
    await expect(runTail(opts)).resolves.toBe(code);
    expect(logs).toBe("live event\n");
    expect(opts.output()).toContain("Run pnpm exec goribu cloudflare-login");
    if (code !== 0) expect(opts.output()).toMatch(/\[Goribu\].*current-app.*exit 7.*goribu tail/);
    expect(opts.output()).not.toContain("shell-test-token");
    expect(existsSync(workDir)).toBe(false);
    expect(opts.signals.eventNames()).toEqual([]);
  }
  expect(readFileSync(join(projectRoot, "wrangler.json"), "utf8")).toContain("stale-worker");
  expect(existsSync(join(projectRoot, ".goribu"))).toBe(false);
});

it("formats terminal HTTP statuses through Wrangler's launcher while preserving prompts and piped JSON", async () => {
  const root = project(), bin = join(root, "wrangler.cjs"), cli = join(root, "cli.cjs");
  const event = { event: { request: { method: "GET", url: "https://example.com/missing" },
    response: { status: 404 } }, outcome: "ok", eventTimestamp: 1790937000000, logs: [], exceptions: [] };
  // Wrangler's installed launcher forwards Node's preload arguments to its CLI.
  writeFileSync(bin, `
    const { spawn } = require("node:child_process");
    spawn(process.execPath, [...process.execArgv, ${JSON.stringify(cli)}, ...process.argv.slice(2)],
      { stdio: "inherit" }).on("exit", (code) => { process.exitCode = code; });
  `);
  writeFileSync(cli, `
    process.stdout.write("Select an account: ");
    console.log("selected");
    console.log(JSON.stringify(${JSON.stringify(event)}, null, 4));
    console.log('{"unrelated":true}');
    console.log("{not json}");
    console.log("multiple", "arguments");
  `);
  for (const terminal of [false, true]) {
    let logs = "", heading = "";
    const opts = options({ resolveBin: () => bin,
      stdout: { isTTY: terminal, write(text) { heading += text; } },
      spawn: (command, args, settings) => {
        expect(settings.stdio).toEqual(["inherit", "inherit", "pipe"]);
        if (terminal) {
          expect(args.slice(-2)).toEqual(["--format", "json"]);
          expect(args[0]).toBe("--import");
        } else expect(args).not.toContain("--import");
        const child = nodeSpawn(command, args, { ...settings, stdio: ["ignore", "pipe", "pipe"] });
        child.stdout.on("data", (chunk) => { logs += chunk; });
        return child;
      },
    });
    await expect(runTail(opts)).resolves.toBe(0);
    expect(logs).toContain("Select an account: selected\n");
    expect(logs).toContain('{"unrelated":true}\n{not json}\nmultiple arguments\n');
    if (terminal) {
      expect(heading).toContain("Opening live logs for Worker test-app");
      expect(logs).toContain("GET https://example.com/missing - 404 Not Found @ ");
      expect(logs).not.toContain('"outcome"');
    } else {
      expect(heading).toBe("");
      expect(logs).toContain(JSON.stringify(event, null, 4));
    }
  }
});

it("fails before starting Wrangler when application config is missing", async () => {
  const spawn = vi.fn(), resolveBin = vi.fn();
  await expect(runTail({ projectRoot: project(), spawn, resolveBin })).rejects.toThrow(/goribu.config.js.*is missing/);
  expect(spawn).not.toHaveBeenCalled();
  expect(resolveBin).not.toHaveBeenCalled();
});

it("explains resolution and launch failures and cleans up temporary config and listeners", async () => {
  const cause = new Error("executable unavailable"), spawn = vi.fn();
  await expect(runTail(options({ spawn, resolveBin: () => { throw cause; } })))
    .rejects.toThrow(/\[Goribu\].*Could not find Wrangler.*pnpm install.*goribu tail/);
  expect(spawn).not.toHaveBeenCalled();
  for (const synchronous of [true, false]) {
    let workDir;
    const opts = options({ spawn: (_command, _args, settings) => {
      workDir = settings.cwd;
      if (synchronous) throw cause;
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("error", cause));
      return child;
    } });
    await expect(runTail(opts)).rejects.toThrow(/\[Goribu\].*Could not start log streaming.*goribu tail/);
    expect(existsSync(workDir)).toBe(false);
    expect(opts.signals.eventNames()).toEqual([]);
  }
});

it("forwards stop signals, waits for Wrangler cleanup and retains genuine nonzero exits", async () => {
  for (const [stopSignal, code, exitSignal, laterHangup = false] of [
    ["SIGINT", 0, null], ["SIGTERM", 0, null], ["SIGHUP", 0, null],
    ["SIGINT", null, "SIGTERM"], ["SIGINT", 5, null], ["SIGINT", 5, null, true],
  ]) {
    let child, workDir;
    const ready = Promise.withResolvers();
    const opts = options({ spawn: (_command, args) => {
      workDir = dirname(args[4]);
      child = new EventEmitter();
      child.stderr = new PassThrough();
      child.kill = vi.fn();
      ready.resolve();
      return child;
    } });
    const running = runTail(opts);
    await ready.promise;
    expect(opts.signals.emit(stopSignal)).toBe(true);
    // pnpm may forward a signal the terminal already sent to the whole group.
    expect(opts.signals.emit(stopSignal)).toBe(true);
    if (laterHangup) expect(opts.signals.emit("SIGHUP")).toBe(true);
    expect(child.kill).toHaveBeenCalledExactlyOnceWith(stopSignal === "SIGHUP" ? "SIGTERM" : stopSignal);
    expect(existsSync(workDir)).toBe(true);
    child.stderr.end("Wrangler cleanup diagnostic\n");
    child.emit("close", code, exitSignal);
    await expect(running).resolves.toBe(code ?? 0);
    expect(opts.signals.eventNames()).toEqual([]);
    expect(existsSync(workDir)).toBe(false);
    if (stopSignal === "SIGHUP" || laterHangup) expect(opts.output()).toBe("");
    else {
      expect(opts.output()).toContain("Wrangler cleanup diagnostic");
      if (code === 5) expect(opts.output()).toMatch(/\[Goribu\].*failed while closing.*exit 5.*Remote cleanup could not be confirmed/);
      else expect(opts.output()).not.toContain("[Goribu]");
    }
  }
});

it("reports an unexpected signal or missing exit code instead of silently succeeding", async () => {
  for (const signal of ["SIGKILL", null]) {
    const opts = options({ spawn: () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("close", null, signal));
      return child;
    } });
    if (signal) await expect(runTail(opts)).rejects.toThrow(/\[Goribu\].*signal SIGKILL.*goribu tail/);
    else await expect(runTail(opts)).resolves.toBe(1);
    expect(opts.signals.eventNames()).toEqual([]);
  }
});

it.skipIf(process.platform === "win32")("finishes child cleanup when a terminal group receives interrupt, termination and hangup", async () => {
  const root = project(), marker = join(root, "closed"), bin = join(root, "wrangler.cjs");
  writeFileSync(bin, `
    const fs = require("node:fs");
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      setTimeout(() => {
        process.stderr.write("Final diagnostic after shutdown\\n");
        fs.writeFileSync(${JSON.stringify(marker)}, "closed");
        process.exit(0);
      }, 100);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    setInterval(() => {}, 1000);
    console.log(JSON.stringify({ configPath: process.argv[5], pid: process.pid }));
  `);
  const runner = join(root, "runner.mjs");
  writeFileSync(runner, `
    import { runTail } from ${JSON.stringify(new URL("../src/build/run-tail.js", import.meta.url).href)};
    process.exitCode = await runTail({ projectRoot: ${JSON.stringify(root)},
      loadConfig: async () => ({ name: "test-app" }), resolveBin: () => ${JSON.stringify(bin)} });
  `);
  const child = nodeSpawn(process.execPath, [runner], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "", errors = "", ready;
  child.stdout.on("data", (chunk) => {
    output += chunk;
    if (output.includes("\n")) ready = JSON.parse(output.split("\n")[0]);
  });
  child.stderr.on("data", (chunk) => { errors += chunk; });
  try {
    await vi.waitFor(() => expect(ready).toBeDefined());
    // These are the signals observed from an interrupted pnpm/PTY session.
    // Only this test's process group is targeted; Wrangler owns a separate one.
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.kill(-child.pid, signal);
    await vi.waitFor(() => expect(child.exitCode, errors).toBe(0));
    expect(readFileSync(marker, "utf8")).toBe("closed");
    expect(existsSync(dirname(ready.configPath))).toBe(false);
    expect(errors).toBe("");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (ready && !existsSync(marker)) {
      try { process.kill(ready.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  }
});

it.skipIf(process.platform === "win32")("bounds stalled shutdown and stops both Wrangler's launcher and its child CLI", async () => {
  const root = project(), bin = join(root, "wrangler.cjs"), runner = join(root, "runner.mjs");
  const hangingCli = `
    process.on("SIGINT", () => {});
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
    console.log("ready");
  `;
  writeFileSync(bin, `
    const { spawn } = require("node:child_process");
    const child = spawn(process.execPath, ["-e", ${JSON.stringify(hangingCli)}],
      { stdio: ["ignore", "pipe", "inherit"] });
    process.on("SIGINT", () => child.kill("SIGTERM"));
    process.on("SIGTERM", () => child.kill("SIGTERM"));
    child.stdout.once("data", () => console.log(JSON.stringify({ configPath: process.argv[5], pid: process.pid })));
  `);
  writeFileSync(runner, `
    import { runTail } from ${JSON.stringify(new URL("../src/build/run-tail.js", import.meta.url).href)};
    process.exitCode = await runTail({ projectRoot: ${JSON.stringify(root)}, shutdownTimeoutMs: 50,
      loadConfig: async () => ({ name: "test-app" }), resolveBin: () => ${JSON.stringify(bin)} });
  `);
  const child = nodeSpawn(process.execPath, [runner], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "", errors = "", ready;
  child.stdout.on("data", (chunk) => {
    output += chunk;
    if (output.includes("\n")) ready = JSON.parse(output.split("\n")[0]);
  });
  child.stderr.on("data", (chunk) => { errors += chunk; });
  try {
    await vi.waitFor(() => expect(ready).toBeDefined());
    child.kill("SIGINT");
    // The grandchild keeps stderr open: close cannot complete if only the
    // launcher is killed, so successful runner exit proves group cleanup.
    await vi.waitFor(() => expect(child.exitCode, errors).toBe(130));
    expect(errors).toMatch(/\[Goribu\].*forcibly stopped.*cleanup could not be confirmed.*expire automatically/);
    expect(existsSync(dirname(ready.configPath))).toBe(false);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (ready && child.exitCode !== 130) {
      try { process.kill(-ready.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  }
});
