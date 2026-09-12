import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";

const packageDir = fileURLToPath(new URL("../", import.meta.url));
const templateDir = fileURLToPath(new URL("../../../templates/basic-app/", import.meta.url));
const taskDir = mkdtempSync(join(tmpdir(), "goribu-scaffold-test-"));
const cli = join(taskDir, "package/bin/create-goribu.js");
const frameworkArchive = join(taskDir, "framework with spaces.tgz");
const scaffolderVersion = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).version;
const frameworkVersion = JSON.parse(readFileSync(new URL("../../goribu/package.json", import.meta.url), "utf8")).version;

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

function templateSourceFixture(name) {
  const source = join(taskDir, name);
  const scaffolder = join(source, "packages/create-goribu");
  const template = join(source, "templates/basic-app");
  mkdirSync(join(scaffolder, "scripts"), { recursive: true });
  mkdirSync(join(source, "packages/goribu"), { recursive: true });
  mkdirSync(template, { recursive: true });
  for (const path of ["package.json", "scripts/build-template.js"]) {
    cpSync(join(packageDir, path), join(scaffolder, path));
  }
  cpSync(join(resolveRepositoryRoot(), "packages/goribu/package.json"), join(source, "packages/goribu/package.json"));
  for (const path of [".gitignore", "AGENTS.md", "README.md", "package.json", "goribu.config.js", "vite.config.js", "tsconfig.json", "src"]) {
    cpSync(join(templateDir, path), join(template, path), { recursive: true });
  }
  symlinkSync(join(packageDir, "node_modules"), join(scaffolder, "node_modules"), "dir");
  return { source, template, build: join(scaffolder, "scripts/build-template.js"), payload: join(scaffolder, "dist/template.json") };
}

beforeAll(() => {
  // Run the actual pack lifecycle, then use only its extracted artifact. This
  // catches missing payloads/dotfiles and accidental runtime workspace imports.
  succeeds(command("pnpm", ["--dir", packageDir, "pack", "--pack-destination", taskDir], resolveRepositoryRoot()));
  succeeds(command("tar", ["-xzf", join(taskDir, `create-goribu-${scaffolderVersion}.tgz`), "-C", taskDir]));
  // Generation records this file, but never installs or executes its contents.
  writeFileSync(frameworkArchive, "fixture: generator does not install this archive");
}, 30000);

afterAll(() => rmSync(taskDir, { recursive: true, force: true }));

it("generates an app pinned to the matching framework release by default", () => {
  const result = generate("release-app");
  succeeds(result);
  const pkg = JSON.parse(readFileSync(join(taskDir, "release-app/package.json"), "utf8"));
  expect(pkg.dependencies.goribu).toBe(frameworkVersion);
  expect(pkg.scripts.typecheck).toBe("tsc --noEmit");
  expect(readFileSync(join(taskDir, "release-app/src/routes/hello.tsx"), "utf8")).toContain("Handler<HelloProps>");
  expect(result.stdout).toContain("TypeScript + Tailwind");
  expect(existsSync(join(taskDir, "release-app/node_modules"))).toBe(false);
  expect(readFileSync(join(taskDir, "package/LICENSE"), "utf8"))
    .toBe(readFileSync(new URL("../../../LICENSE", import.meta.url), "utf8"));
});

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
  for (const path of ["src/routes/index.tsx", "src/routes/hello.tsx", "src/routes/_document.tsx", "src/styles.css", "vite.config.js", "AGENTS.md", "tsconfig.json"]) {
    expect(readFileSync(join(app, path))).toEqual(readFileSync(join(templateDir, path)));
  }
  const readme = readFileSync(join(app, "README.md"), "utf8");
  expect(readme).toContain("pnpm run deploy");
  expect(readme).not.toContain("workspace:*");
  expect(readme).not.toContain("repository-only");
  expect(readFileSync(join(app, "pnpm-workspace.yaml"), "utf8"))
    .toBe("packages:\n  - .\n\nonlyBuiltDependencies:\n  - esbuild\n  - workerd\n");
  for (const path of ["node_modules", "dist", ".goribu", ".wrangler", ".git", "pnpm-lock.yaml", ".env"]) {
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
    expect(result.stderr).toMatch(/\[Goribu\][\s\S]*never overwritten/);
  }
  expect(readdirSync(join(taskDir, "empty"))).toEqual([]);
  expect(readdirSync(join(taskDir, "owned"))).toEqual(["keep.txt"]);
  expect(readFileSync(join(taskDir, "owned/keep.txt"), "utf8")).toBe("maintainer data");
  expect(readFileSync(join(taskDir, "file"), "utf8")).toBe("maintainer file");
});

it("explains bad arguments with specific repairs before creating files", () => {
  for (const [args, message] of [
    [[], /Missing project name.*\nRun: npx create-goribu my-app/],
    [["../escape"], /Expected a project name, received path.*\nRun this command from the parent directory/],
    [["Uppercase"], /Invalid project name.*\nUse 1–50 lowercase/],
    [["bad-"], /ending with a letter or digit/],
    [["bad", "--ts"], /TypeScript is the default. Remove --ts/],
    [["bad", "--jss"], /Unknown option.*\nDid you mean --js/],
    [["bad", "--unknown"], /Supported options: --js, --goribu-tarball <path>, --help/],
    [["bad", "extra"], /Unexpected extra argument.*\nPass one project name/],
    [["bad", "--js", "--js"], /supplied more than once.*\nKeep one --js/],
    [["bad", "--goribu-tarball"], /Missing file path after.*\nPass a local archive/],
    [["bad", "--goribu-tarball", "missing.tgz"], /was not found.*\nCheck the path relative to/],
  ]) {
    const result = generate(...args);
    expect(result.status, JSON.stringify(args)).toBe(1);
    expect(result.stderr).toMatch(message);
  }
  expect(existsSync(join(taskDir, "bad"))).toBe(false);
  expect(existsSync(join(taskDir, "escape"))).toBe(false);
  succeeds(generate("--help"));
  expect(generate("--help").stdout).toContain("JavaScript");
  succeeds(generate("bad", "--help"));
});

it("generates JavaScript with JSX, working file references, and no TypeScript setup", () => {
  const result = generate("--js", "javascript-app");
  succeeds(result);
  const app = join(taskDir, "javascript-app");
  const pkg = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
  expect(pkg.dependencies.goribu).toBe(frameworkVersion);
  expect(pkg.scripts.typecheck).toBeUndefined();
  expect(Object.keys(pkg.devDependencies)).not.toEqual(expect.arrayContaining(["typescript"]));
  expect(Object.keys(pkg.devDependencies).some((name) => name.startsWith("@types/"))).toBe(false);
  const hello = readFileSync(join(app, "src/routes/hello.jsx"), "utf8");
  expect(hello).toContain("export const GET");
  expect(hello).toContain("<Link");
  expect(hello).not.toMatch(/import type|HelloProps|goribu\/server|satisfies/);
  expect(readFileSync(join(app, "src/routes/index.jsx"), "utf8")).toContain("src/routes/index.jsx");
  for (const path of ["README.md", "AGENTS.md"]) {
    expect(readFileSync(join(app, path), "utf8")).not.toMatch(/\.tsx|tsconfig|pnpm typecheck|typescript-only/);
  }
  expect(readFileSync(join(app, "README.md"), "utf8")).toContain("src/routes/hello.jsx");
  expect(readFileSync(join(app, "AGENTS.md"), "utf8")).toContain("`.server.js`");
  for (const path of ["tsconfig.json", "src/routes/index.tsx", "node_modules", ".git"]) expect(existsSync(join(app, path))).toBe(false);
  expect(result.stdout).toContain("JavaScript + Tailwind");
  expect(result.stdout).not.toContain("pnpm typecheck");
});

it("preserves shared documentation while removing only marked TypeScript guidance from JavaScript output", () => {
  const fixture = templateSourceFixture("shared-docs");
  const shared = "JavaScript output is generated from the TypeScript starter.";
  for (const path of ["README.md", "AGENTS.md"]) {
    const file = join(fixture.template, path);
    writeFileSync(file, readFileSync(file, "utf8") + `\n${shared}\n`);
  }
  succeeds(command(process.execPath, [fixture.build], fixture.source));
  const { templates } = JSON.parse(readFileSync(fixture.payload, "utf8"));
  for (const path of ["README.md", "AGENTS.md"]) {
    const javascript = Buffer.from(templates.javascript[path], "base64").toString("utf8");
    expect(javascript).toContain(shared);
    expect(javascript).not.toMatch(/pnpm typecheck|typescript-only|\.tsx/);
    expect(Buffer.from(templates.typescript[path], "base64")).toEqual(readFileSync(join(fixture.template, path)));
  }
});

it("explains malformed starter manifests before writing a packaged template", () => {
  const fixture = templateSourceFixture("invalid-template");
  const manifest = join(fixture.template, "package.json");
  const original = JSON.parse(readFileSync(manifest, "utf8"));
  const cases = [["{broken", "Restore valid JSON in that file before packaging."]];
  for (const field of ["scripts", "devDependencies"]) {
    for (const value of [undefined, null, [], "invalid"]) {
      cases.push([JSON.stringify({ ...original, [field]: value }), `Restore the ${field} map in that file before packaging.`]);
    }
  }
  for (const [content, repair] of cases) {
    writeFileSync(manifest, content);
    const result = command(process.execPath, [fixture.build], fixture.source);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("[Goribu] Cannot package the starter because templates/basic-app/package.json");
    expect(result.stderr).toContain(repair);
    expect(result.stderr).not.toContain("TypeError");
    expect(existsSync(fixture.payload)).toBe(false);
  }
});

it("distinguishes package defects and permission failures without blaming project files", () => {
  const broken = join(taskDir, "broken-package");
  cpSync(join(taskDir, "package"), broken, { recursive: true });
  writeFileSync(join(broken, "dist/template.json"), "{broken");
  const result = command(process.execPath, [join(broken, "bin/create-goribu.js"), "broken-app"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/packaged starter is missing or unreadable/);
  expect(result.stderr).toContain("https://github.com/anges244/goribu/issues");
  expect(result.stderr).not.toMatch(/filesystem permissions|run build/);
  expect(existsSync(join(taskDir, "broken-app"))).toBe(false);
  const locked = join(taskDir, "locked");
  mkdirSync(locked);
  chmodSync(locked, 0o555);
  try {
    const denied = command(process.execPath, [cli, "new-app"], locked);
    expect(denied.status).toBe(1);
    expect(denied.stderr).toMatch(/EACCES|EPERM/);
    expect(denied.stderr).toContain("Check permissions");
    expect(denied.stderr).not.toContain("already exists");
    expect(readdirSync(locked)).toEqual([]);
  } finally { chmodSync(locked, 0o755); }
});

it("refuses to package mismatched versions or versions outside the single release channel", () => {
  // Exercise the real build script in a source fixture, before it reads any
  // template files. Never change the workspace manifests or generated payload.
  const source = join(taskDir, "invalid-release");
  const scripts = join(source, "packages/create-goribu/scripts");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(join(source, "packages/goribu"), { recursive: true });
  const build = join(scripts, "build-template.js");
  writeFileSync(build, readFileSync(join(packageDir, "scripts/build-template.js")));
  for (const [framework, scaffolder] of [
    ["0.7.0", "0.7.1"],
    ["0.7.0-alpha.1", "0.7.0-alpha.1"],
    ["0.0.0", "0.0.0"],
    ["latest", "latest"],
  ]) {
    writeFileSync(join(source, "packages/goribu/package.json"), JSON.stringify({ version: framework }));
    writeFileSync(join(source, "packages/create-goribu/package.json"), JSON.stringify({ type: "module", version: scaffolder }));
    const result = command(process.execPath, [build], source);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/\[Goribu\] Cannot package.*Set both package versions/);
    expect(existsSync(join(source, "packages/create-goribu/dist"))).toBe(false);
  }
});
