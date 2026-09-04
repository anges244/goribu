import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("../bin/goribu.js", import.meta.url));

function runCli(args) {
  try {
    const stdout = execFileSync(process.execPath, [cliPath, ...args], { encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return { status: error.status, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

describe("goribu CLI", () => {
  it("lists the complete migration verb set in help", () => {
    const { status, stdout } = runCli(["--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("migrate:down");
    expect(stdout).toContain("migrate:seed");
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

  it("rejects trailing arguments to dev without starting the server", () => {
    const { status, stderr } = runCli(["dev", "--definitely-not-a-real-option"]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/\[Goribu\] `goribu dev` does not accept arguments/);
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

  it("requires a name for migrate:new", () => {
    const { status, stderr } = runCli(["migrate:new"]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/takes a descriptive name/);
  });
});
