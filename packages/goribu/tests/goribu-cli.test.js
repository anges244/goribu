import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("../bin/goribu.js", import.meta.url));

function runCli(args, nodeArgs = []) {
  try {
    const stdout = execFileSync(process.execPath, [...nodeArgs, cliPath, ...args], { encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return { status: error.status, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

describe("goribu CLI", () => {
  it("lists Cloudflare login, tail, and migration commands in help", () => {
    const { status, stdout } = runCli(["--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("migrate:down");
    expect(stdout).toContain("migrate:seed");
    expect(stdout).toMatch(/cloudflare-login\s+Log in to Cloudflare through Wrangler\./);
    expect(stdout).toMatch(/tail\s+.*logs/);
    expect(stdout).toMatch(/wrangler\s+Run Goribu's Wrangler with the deploy account/);
  });

  it("prints the version", () => {
    const { status, stdout } = runCli(["--version"]);
    expect(status).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("fails closed on an unknown command", () => {
    const { status, stderr } = runCli(["frobnicate"]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/\[Goribu\] Unknown command/);
    expect(stderr).toMatch(/dev, build, check, deploy/);
  });

  it("rejects trailing arguments to build without building", () => {
    const { status, stderr } = runCli(["build", "--definitely-not-a-real-option"]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/\[Goribu\] `goribu build` does not accept arguments/);
  });

  it.each([
    [["--definitely-not-a-real-option"], /`goribu dev` accepts only --port <number> and --host/],
    [["--port"], /needs a port number from 1 to 65535, but received nothing/],
    [["--port=70000"], /needs a port number from 1 to 65535, but received "70000"/],
    [["--port", "5199", "--port", "5200"], /received --port more than once/],
    [["--host", "0.0.0.0"], /takes no address, but received "0.0.0.0".*`server.host` in vite.config.js/],
  ])("rejects dev arguments %j without starting the server", (args, message) => {
    const { status, stderr } = runCli(["dev", ...args]);
    expect(status).toBe(1);
    expect(stderr).toMatch(message);
  });

  it("rejects trailing arguments to check without inspecting Cloudflare", () => {
    const { status, stderr } = runCli(["check", "--definitely-not-a-real-option"]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/\[Goribu\] `goribu check` does not accept arguments/);
  });

  it("rejects trailing arguments to deploy without deploying", () => {
    const { status, stderr } = runCli(["deploy", "--definitely-not-a-real-option"]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/\[Goribu\] `goribu deploy` does not accept arguments/);
  });

  it("rejects trailing arguments to tail before loading config or connecting", () => {
    const { status, stderr } = runCli(["tail", "--env", "staging"]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/\[Goribu\] `goribu tail` does not accept arguments/);
    expect(stderr).not.toMatch(/goribu\.config\.js.*is missing/);
  });

  it("requires application config before starting tail", () => {
    const { status, stderr } = runCli(["tail"]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/\[Goribu\].*goribu\.config\.js.*is missing/);
    // An expected failure says how to repair it and why; stacks would only add noise.
    expect(stderr).toMatch(/^Caused by: Error: ENOENT: no such file or directory/m);
    expect(stderr).not.toMatch(/^\s+at /m);
  });

  it("does not repeat a cause the Goribu error message already states", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "goribu-cli-"));
    try {
      writeFileSync(join(projectRoot, "goribu.config.js"), 'throw new Error("config exploded");\n');
      const preload = `process.chdir(${JSON.stringify(projectRoot)});`;
      const { status, stderr } = runCli(["migrate:status"], ["--import", `data:text/javascript,${encodeURIComponent(preload)}`]);
      expect(status).toBe(1);
      expect(stderr).toMatch(/^\[Goribu\] Could not load .*goribu\.config\.js.*config exploded\n$/);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("dispatches tail for the configured production Worker and forwards its exit status", () => {
    const fixtureRoot = fileURLToPath(new URL("../../../fixtures/basic-app/", import.meta.url));
    for (const code of [0, 2]) {
      // Load the real app config and CLI, replacing only the Wrangler subprocess
      // so this contract test never connects to Cloudflare.
      const preload = `
        import childProcess from "node:child_process";
        import { syncBuiltinESMExports } from "node:module";
        import { EventEmitter } from "node:events";
        import { readFileSync } from "node:fs";
        import { dirname } from "node:path";
        import assert from "node:assert/strict";
        process.chdir(${JSON.stringify(fixtureRoot)});
        childProcess.spawn = (command, args, options) => {
          assert.equal(command, process.execPath);
          assert.match(args[0], /wrangler[.]js$/);
          const configPath = args[4];
          assert.deepEqual(args.slice(1), ["tail", "goribu-basic-app", "--config", configPath, "--env", ""]);
          assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), { name: "goribu-basic-app" });
          assert.notEqual(options.cwd, process.cwd());
          assert.deepEqual(options, { cwd: dirname(configPath), stdio: ["inherit", "inherit", "pipe"], detached: process.platform !== "win32" });
          const child = new EventEmitter();
          queueMicrotask(() => child.emit("close", ${code}, null));
          return child;
        };
        syncBuiltinESMExports();
      `;
      const result = runCli(["tail"], ["--import", `data:text/javascript,${encodeURIComponent(preload)}`]);
      expect(result.status).toBe(code);
      if (code === 0) expect(result.stderr).toBe("");
      else expect(result.stderr).toMatch(/\[Goribu\].*rerun `goribu tail`/);
    }
  });

  it("rejects trailing arguments to cloudflare-login without starting login", () => {
    const { status, stderr } = runCli(["cloudflare-login", "--remote"]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/\[Goribu\] `goribu cloudflare-login` does not accept arguments/);
  });

  it("dispatches cloudflare-login to the installed Wrangler and forwards its exit status", () => {
    for (const code of [0, 2]) {
      // Replace only process creation in the CLI subprocess: never open a browser
      // or touch real credentials while exercising the public command end to end.
      const preload = `
        import childProcess from "node:child_process";
        import { syncBuiltinESMExports } from "node:module";
        import { EventEmitter } from "node:events";
        import assert from "node:assert/strict";
        childProcess.spawn = (command, args, options) => {
          assert.equal(command, process.execPath);
          assert.match(args[0], /wrangler[.]js$/);
          assert.deepEqual(args.slice(1), ["login"]);
          assert.deepEqual(options, { cwd: process.cwd(), stdio: ["inherit", "inherit", "pipe"] });
          const child = new EventEmitter();
          queueMicrotask(() => child.emit("close", ${code}, null));
          return child;
        };
        syncBuiltinESMExports();
      `;
      const result = runCli(["cloudflare-login"], ["--import", `data:text/javascript,${encodeURIComponent(preload)}`]);
      expect(result.stderr).toBe("");
      expect(result.status).toBe(code);
    }
  });

  it("fails closed on conflicting migration targets", () => {
    const { status, stderr } = runCli(["migrate", "--local", "--remote"]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/cannot target both --local and --remote/);
  });

  it("rejects an unknown migrate flag", () => {
    const { status, stderr } = runCli(["migrate", "--bogus"]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/accepts only --local \(default\) or --remote/);
  });

  it("dispatches migrate:down through migration target validation", () => {
    const { status, stderr } = runCli(["migrate:down", "--bogus"]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/`goribu migrate:down` accepts only --local/);
  });

  it("rejects migrate:seed --remote at the CLI safety boundary", () => {
    const { status, stderr } = runCli(["migrate:seed", "--remote"]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/never runs against production/);
  });

  it("dispatches migrate:seed locally by default", () => {
    const { status, stderr } = runCli(["migrate:seed"]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/goribu\.config\.js.*is missing/);
    expect(stderr).not.toMatch(/never runs against production/);
  });

  it("takes goribu d1 SQL as one quoted argument with migration target flags", () => {
    expect(runCli(["d1"]).stderr).toMatch(/takes the SQL as one quoted argument, but received none/);
    expect(runCli(["d1", "SELECT", "1"]).stderr).toMatch(/received 2 arguments/);
    expect(runCli(["d1", "--bogus", "SELECT 1"]).stderr).toMatch(/`goribu d1` accepts only --local \(default\) or --remote/);
    // SQL that starts with a comment is SQL, not an option; it reaches config loading.
    const { status, stderr } = runCli(["d1", "-- inspect\nSELECT 1"]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/goribu\.config\.js.*is missing/);
  });

  it("requires a name for migrate:new", () => {
    const { status, stderr } = runCli(["migrate:new"]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/takes a descriptive name/);
  });
});
