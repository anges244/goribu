import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const templateDir = fileURLToPath(new URL("../../../templates/basic-app/", import.meta.url));
const taskDir = mkdtempSync(join(tmpdir(), "goribu-scaffold-test-"));
const cli = join(taskDir, "package/bin/create-goribu.js");
const frameworkArchive = join(taskDir, "framework with spaces.tgz");

function resolveRepositoryRoot() {
  // Corepack chooses the pinned pnpm before processing --dir.
  return fileURLToPath(new URL("../../../", import.meta.url));
}

function command(bin, args, cwd = taskDir) {
  return spawnSync(bin, args, { cwd, encoding: "utf8", timeout: 30000 });
}
function succeeds(result) {
  expect(result.error).toBeUndefined();
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}
function generate(...args) {
  return command(process.execPath, [cli, ...args]);
}

beforeAll(() => {
  // Run the actual pack lifecycle, then use only its extracted artifact. This
  // catches missing payloads/dotfiles and accidental runtime workspace imports.
  succeeds(command("pnpm", ["--dir", packageDir, "pack", "--pack-destination", taskDir], resolveRepositoryRoot()));
  succeeds(command("tar", ["-xzf", join(taskDir, "create-goribu-0.0.0.tgz"), "-C", taskDir]));
  // Generation records this file, but never installs or executes its contents.
  writeFileSync(frameworkArchive, "fixture: generator does not install this archive");
}, 30000);

afterAll(() => rmSync(taskDir, { recursive: true, force: true }));

it("generates from the packed canonical template without installing or leaking local state", () => {
  const result = generate("my-app", "--goribu-tarball", "framework with spaces.tgz");
  succeeds(result);
  const app = join(taskDir, "my-app");
  const pkg = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
  expect(pkg.name).toBe("my-app");
  expect(pkg.dependencies.goribu).toBe(`file:${realpathSync(frameworkArchive)}`);
  const config = readFileSync(join(app, "goribu.config.js"), "utf8");
  expect(config).toContain('name: "my-app"');
  expect(config).toContain('name: "my-app-db"');
  expect(config).toContain('name: "my-app-kv"');
  expect(readFileSync(join(app, ".gitignore"), "utf8"))
    .toBe(readFileSync(join(templateDir, ".gitignore"), "utf8"));
  for (const path of ["src/routes/index.jsx", "src/routes/hello.jsx", "src/routes/_document.jsx", "src/styles.css", "vite.config.js", "AGENTS.md"]) {
    expect(readFileSync(join(app, path))).toEqual(readFileSync(join(templateDir, path)));
  }
  const readme = readFileSync(join(app, "README.md"), "utf8");
  expect(readme).toContain("pnpm run deploy");
  expect(readme).not.toContain("workspace:*");
  expect(readme).not.toContain("repository-only");
  expect(readFileSync(join(app, "pnpm-workspace.yaml"), "utf8"))
    .toBe("packages:\n  - .\n\nonlyBuiltDependencies:\n  - esbuild\n  - workerd\n");
  for (const path of ["node_modules", "dist", ".goribu", ".wrangler", ".git", "pnpm-lock.yaml", ".env", "tsconfig.json"]) {
    expect(existsSync(join(app, path)), path).toBe(false);
  }
  expect(result.stdout).toContain("pnpm run deploy");
  expect(result.stdout).toContain("Nothing was installed");
});

it("rejects existing targets, including empty directories and symlinks, without changing them", () => {
  mkdirSync(join(taskDir, "empty"));
  mkdirSync(join(taskDir, "owned"));
  writeFileSync(join(taskDir, "owned/keep.txt"), "maintainer data");
  symlinkSync(join(taskDir, "owned"), join(taskDir, "linked"), "dir");
  symlinkSync(join(taskDir, "missing"), join(taskDir, "dangling"), "dir");
  writeFileSync(join(taskDir, "file"), "maintainer file");
  for (const name of ["empty", "owned", "linked", "dangling", "file"]) {
    const result = generate(name, "--goribu-tarball", frameworkArchive);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/\[Goribu\].*never overwritten/);
  }
  expect(readdirSync(join(taskDir, "empty"))).toEqual([]);
  expect(readdirSync(join(taskDir, "owned"))).toEqual(["keep.txt"]);
  expect(readFileSync(join(taskDir, "owned/keep.txt"), "utf8")).toBe("maintainer data");
  expect(readFileSync(join(taskDir, "file"), "utf8")).toBe("maintainer file");
});

it("fails before creating files for bad arguments, missing tarballs and the unpublished default", () => {
  for (const args of [[], ["../escape"], ["Uppercase"], ["bad", "--ts"], ["bad", "extra"], ["bad", "--goribu-tarball"], ["bad", "--goribu-tarball", "missing.tgz"], ["bad"]]) {
    const result = generate(...args);
    expect(result.status, JSON.stringify(args)).toBe(1);
    expect(result.stderr).toMatch(/\[Goribu\].*(Supply|Unexpected|needs|Cannot use|unpublished)/);
  }
  expect(existsSync(join(taskDir, "bad"))).toBe(false);
  expect(existsSync(join(taskDir, "escape"))).toBe(false);
  succeeds(generate("--help"));
  expect(generate("--help").stdout).toContain("JavaScript");
});
