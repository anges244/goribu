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
  it("prints the version", () => {
    const { status, stdout } = runCli(["--version"]);
    expect(status).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("fails closed on an unknown command", () => {
    const { status, stderr } = runCli(["frobnicate"]);
    expect(status).toBe(1);
    expect(stderr).toMatch(/\[Goribu\] Unknown command/);
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
});
