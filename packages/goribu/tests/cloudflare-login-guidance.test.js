import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, expect, it } from "vitest";

const root = mkdtempSync(join(tmpdir(), "goribu-auth-guidance-"));
const cli = fileURLToPath(new URL("../bin/goribu.js", import.meta.url));
const fakeWrangler = join(root, "wrangler.cjs");
const preload = join(root, "preload.mjs");
symlinkSync(fileURLToPath(new URL("../../../fixtures/basic-app/node_modules", import.meta.url)), join(root, "node_modules"), "dir");
writeFileSync(join(root, "package.json"), '{"type":"module"}');
// Real pipes and CLI dispatch, with only the Wrangler executable substituted.
// No browser, credentials, or Cloudflare requests are involved.
writeFileSync(preload, `
  import childProcess from "node:child_process";
  import { syncBuiltinESMExports } from "node:module";
  import assert from "node:assert/strict";
  const spawn = childProcess.spawn;
  childProcess.spawn = (command, args, options) => {
    assert.equal(command, process.execPath);
    assert.match(args[0], /wrangler[.]js$/);
    return spawn(command, [${JSON.stringify(fakeWrangler)}, ...args.slice(1)], options);
  };
  syncBuiltinESMExports();
`);

afterAll(() => rmSync(root, { recursive: true, force: true }));

function configure(resource = "database") {
  writeFileSync(join(root, "goribu.config.js"), `
    import { defineConfig } from "goribu/server";
    export default defineConfig({
      name: "auth-guidance", compatibilityDate: "2026-09-01",
      ${resource === "database" ? 'database: { type: "d1", name: "auth-db" },' : 'kv: { name: "auth-kv" },'}
    });
  `);
}

function run(args) {
  return spawnSync(process.execPath, ["--import", preload, cli, ...args], {
    cwd: root, encoding: "utf8", timeout: 15000,
  });
}

it("uses Goribu login guidance for deploy, resource checks, and remote migrations while preserving failures", () => {
  writeFileSync(fakeWrangler, `
    if (process.argv[2] === "auth") process.stdout.write('{"token":"never-display-this"}');
    process.stderr.write("Not logged in. Please run ");
    setImmediate(() => {
      process.stderr.write("\u0060wrangler login\u0060 to authenticate.\\n");
      process.exitCode = 23;
    });
  `);
  for (const [resource, args] of [
    ["database", ["deploy"]],
    ["database", ["check"]],
    ["kv", ["check"]],
    ["database", ["migrate", "--remote"]],
    ["database", ["migrate:down", "--remote"]],
    ["database", ["migrate:status", "--remote"]],
    ["database", ["cloudflare-login"]],
  ]) {
    configure(resource);
    const result = run(args);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(args[0] === "cloudflare-login" ? 23 : 1);
    expect(result.stderr).toContain("Not logged in. Please run `pnpm exec goribu cloudflare-login` to authenticate.");
    expect(result.stderr).not.toContain("`wrangler login`");
    expect(result.stdout + result.stderr).not.toContain("never-display-this");
  }
});

it("preserves network and SQL diagnostics without claiming that the user is logged out", () => {
  configure();
  for (const [args, diagnostic] of [
    [["check"], "Network request failed: ENOTFOUND api.cloudflare.com"],
    [["migrate:status"], "SQLITE_ERROR: no such column: revision"],
  ]) {
    writeFileSync(fakeWrangler, `process.stderr.write(${JSON.stringify(diagnostic)}); process.exitCode = 1;`);
    const result = run(args);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain(diagnostic);
    expect(result.stderr).not.toContain("Not logged in");
    if (args[0] === "migrate:status") expect(result.stderr).not.toContain("cloudflare-login");
  }
});
