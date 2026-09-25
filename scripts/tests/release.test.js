import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { release } from "../release.js";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const task = mkdtempSync(join(tmpdir(), "goribu-release-test-"));
const source = join(task, "source");
const artifacts = join(task, "artifacts");
const commit = "a".repeat(40);
let receipt;

function execute(bin, args, { cwd = source } = {}) {
  const result = spawnSync(bin, args, {
    cwd, encoding: "utf8", timeout: 30000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, npm_config_cache: join(task, "npm-cache") },
  });
  if (result.error || result.status !== 0) throw new Error(`${bin} failed: ${result.error ?? result.stderr}\n${result.stdout}`);
  return result.stdout;
}

function copySource(destination) {
  // Copy only authored source, never the repository's dependencies or app state.
  const paths = ["package.json", "pnpm-workspace.yaml", "LICENSE"];
  for (const name of ["goribu", "create-goribu"]) {
    for (const path of ["package.json", "README.md", "bin", "src"]) paths.push(`packages/${name}/${path}`);
  }
  paths.push("packages/create-goribu/scripts/build-template.js");
  for (const path of [".gitignore", "AGENTS.md", "README.md", "package.json", "goribu.config.js", "vite.config.js", "tsconfig.json", "src", "public"]) paths.push(`templates/basic-app/${path}`);
  for (const path of paths) {
    mkdirSync(dirname(join(destination, path)), { recursive: true });
    cpSync(join(repository, path), join(destination, path), { recursive: true });
  }
  // Packaging uses the compiler installed for development; the saved CLI does not.
  symlinkSync(join(repository, "packages/create-goribu/node_modules"), join(destination, "packages/create-goribu/node_modules"), "dir");
  // Exercise the first-release migration even after the repository advances.
  for (const name of ["goribu", "create-goribu"]) {
    const path = join(destination, "packages", name, "package.json");
    const pkg = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, JSON.stringify({ ...pkg, version: "0.7.0" }, null, 2) + "\n");
  }
}

function localRun(bin, args, options) {
  // This source fixture has no Git repository. Model the commit boundary and
  // test result; real packing, archive inspection, and CLI execution still run.
  if (bin === "git") {
    if (args[0] === "status" || args[0] === "diff") return "";
    if (args[0] === "rev-parse") return commit;
    if (args[0] === "ls-files") {
      // The simulated clean commit contains the copied fixture, including new
      // authored files that the maintainer has not yet committed in this repo.
      return execute(bin, ["ls-files", "--cached", "--others", "--exclude-standard", ...args.slice(1)], { cwd: repository });
    }
    throw new Error(`Unexpected git command: ${args}`);
  }
  if (bin === "pnpm" && args[0] === "test") return ""; // Avoid recursively invoking this suite.
  if (bin === "npm" && args[0] !== "pack") throw new Error(`Unexpected npm mutation: ${args}`);
  return execute(bin, args, options);
}

function options(overrides = {}) {
  return { root: source, run: localRun, fetch: () => { throw new Error("Unexpected network access"); }, log: () => {}, ...overrides };
}

function registry() {
  const data = Object.fromEntries(["goribu", "create-goribu"].map((name) => {
    const previous = name === "goribu" ? "0.1.0-alpha.9" : "0.6.9";
    return [name, {
      name,
      "dist-tags": { latest: previous, ...(name === "goribu" ? { alpha: previous } : {}) },
      versions: { [previous]: { name, version: previous } },
    }];
  }));
  const mutations = [];
  const reads = [];
  let failScaffolder = false;
  const harness = {
    data, mutations, reads,
    interruptScaffolder() { failScaffolder = true; },
    options: options({
      fetch: async (url) => {
        expect(url).toMatch(/^https:\/\/registry\.npmjs\.org\/(goribu|create-goribu)$/);
        const name = url.split("/").at(-1);
        reads.push(name);
        return Response.json(data[name]);
      },
      run: (bin, args, opts) => {
        if (bin !== "npm" || args[0] === "pack") return localRun(bin, args, opts);
        expect(args).toContain("--registry=https://registry.npmjs.org/");
        if (args[0] === "whoami") return "anges244";
        if (args[0] === "publish") {
          const name = args[1].includes("create-goribu-") ? "create-goribu" : "goribu";
          expect(args).toContain("--ignore-scripts");
          expect(args).toContain("--tag=latest");
          expect(args).toContain("--access=public");
          expect(readFileSync(args[1])).toEqual(readFileSync(join(artifacts, `${name}-0.7.0.tgz`)));
          if (name === "create-goribu") expect(data.goribu["dist-tags"].latest).toBe("0.7.0");
          mutations.push(`publish ${name}`);
          if (name === "create-goribu" && failScaffolder) {
            failScaffolder = false;
            throw new Error("simulated interrupted publication");
          }
          data[name].versions["0.7.0"] = { name, version: "0.7.0", dist: { integrity: receipt.packages.find((item) => item.name === name).integrity } };
          data[name]["dist-tags"].latest = "0.7.0";
          return "";
        }
        if (args[0] === "dist-tag" && args[1] === "add") {
          const [name, version] = args[2].split("@");
          mutations.push(`tag ${name}`);
          data[name]["dist-tags"].latest = version;
          return "";
        }
        if (args[0] === "dist-tag" && args[1] === "rm") {
          expect(data["create-goribu"]["dist-tags"].latest).toBe("0.7.0");
          expect(args.slice(2, 4)).toEqual(["goribu", "alpha"]);
          mutations.push("remove alpha");
          delete data.goribu["dist-tags"].alpha;
          return "";
        }
        throw new Error(`Unexpected npm action: ${args}`);
      },
    }),
  };
  return harness;
}

beforeAll(async () => {
  copySource(source);
  await release(["pack", artifacts], options());
  receipt = JSON.parse(readFileSync(join(artifacts, "release.json"), "utf8"));
}, 30000);
afterAll(() => rmSync(task, { recursive: true, force: true }));

it("packs real archives and generates from them, recording only a completed release", async () => {
  expect(receipt).toMatchObject({ schema: 1, version: "0.7.0", commit });
  expect(receipt.packages.map(({ name }) => name)).toEqual(["goribu", "create-goribu"]);
  expect(existsSync(join(source, "node_modules"))).toBe(false);
  await expect(release(["pack", artifacts], options())).rejects.toThrow(/existing release artifacts are never overwritten/);
  expect(JSON.parse(readFileSync(join(artifacts, "release.json"), "utf8"))).toEqual(receipt);
});

it("prepares both versions and their template together, rejecting backwards or prerelease choices", async () => {
  const root = join(task, "prepare-source");
  copySource(root);
  await release(["prepare", "0.8.0"], options({ root }));
  for (const name of ["goribu", "create-goribu"]) {
    expect(JSON.parse(readFileSync(join(root, `packages/${name}/package.json`), "utf8")).version).toBe("0.8.0");
  }
  expect(JSON.parse(readFileSync(join(root, "packages/create-goribu/dist/template.json"), "utf8")).goribuVersion).toBe("0.8.0");
  for (const version of ["0.7.0", "0.9.0-alpha.1", "0.0.0", "latest"]) {
    await expect(release(["prepare", version], options({ root }))).rejects.toThrow(/\[Goribu\].*(older|Invalid release version)/);
  }
});

it("leaves no completed receipt when the checkout is dirty, tests fail, or the source changes", async () => {
  for (const failure of ["dirty", "tests", "changed"]) {
    const directory = join(task, failure);
    let headReads = 0;
    const run = (bin, args, opts) => {
      if (failure === "dirty" && bin === "git" && args[0] === "status") return " M package.json";
      if (failure === "tests" && bin === "pnpm" && args[0] === "test") throw new Error("test failure");
      if (failure === "changed" && bin === "git" && args[0] === "rev-parse") return (++headReads === 1 ? "a" : "b").repeat(40);
      return localRun(bin, args, opts);
    };
    await expect(release(["pack", directory], options({ run }))).rejects.toThrow(/uncommitted|test failure|source commit changed/);
    expect(existsSync(join(directory, "release.json"))).toBe(false);
  }
});

it("resumes an interrupted pair by verifying and skipping the framework, then retires alpha", async () => {
  const state = registry();
  state.interruptScaffolder();
  await expect(release(["publish", artifacts], state.options)).rejects.toThrow("interrupted publication");
  expect(state.mutations).toEqual(["publish goribu", "publish create-goribu"]);
  expect(state.data.goribu["dist-tags"].alpha).toBe("0.1.0-alpha.9");
  await release(["publish", artifacts], state.options);
  expect(state.mutations).toEqual(["publish goribu", "publish create-goribu", "publish create-goribu", "remove alpha"]);
  await release(["publish", artifacts], state.options);
  expect(state.mutations).toHaveLength(4);
}, 30000);

it("repairs latest for an identical existing archive without republishing it", async () => {
  const state = registry();
  state.data.goribu.versions["0.7.0"] = { name: "goribu", version: "0.7.0", dist: { integrity: receipt.packages[0].integrity } };
  await release(["publish", artifacts], state.options);
  expect(state.mutations).toEqual(["tag goribu", "publish create-goribu", "remove alpha"]);
}, 15000);

it("checks both registry names before publishing and refuses collisions or a latest downgrade", async () => {
  for (const failure of ["collision", "downgrade", "missing integrity", "null record"]) {
    const state = registry();
    const pkg = state.data["create-goribu"];
    if (failure === "downgrade") {
      pkg.versions["0.8.0"] = { name: "create-goribu", version: "0.8.0" };
      pkg["dist-tags"].latest = "0.8.0";
    } else if (failure === "null record") {
      pkg.versions["0.7.0"] = null;
    } else {
      pkg.versions["0.7.0"] = { name: "create-goribu", version: "0.7.0", dist: failure === "collision" ? { integrity: "sha512-wrong" } : {} };
    }
    await expect(release(["publish", artifacts], state.options)).rejects.toThrow(/different or unverifiable bytes|older than/);
    expect(state.mutations).toEqual([]);
  }
}, 30000);

it("rejects altered archives or receipts and a different checkout before contacting npm", async () => {
  for (const failure of ["archive", "receipt", "commit"]) {
    const directory = join(task, `altered-${failure}`);
    cpSync(artifacts, directory, { recursive: true });
    if (failure === "archive") writeFileSync(join(directory, receipt.packages[1].filename), "changed bytes");
    if (failure === "receipt") writeFileSync(join(directory, "release.json"), JSON.stringify({ ...receipt, packages: [{ ...receipt.packages[0], filename: "../escape.tgz" }, receipt.packages[1]] }));
    if (failure === "commit") writeFileSync(join(directory, "release.json"), JSON.stringify({ ...receipt, commit: "b".repeat(40) }));
    const state = registry();
    await expect(release(["publish", directory], state.options)).rejects.toThrow(/changed after packing|invalid package identities|source commit changed/);
    expect(state.reads).toEqual([]);
    expect(state.mutations).toEqual([]);
  }
}, 15000);

it("treats registry failures and malformed metadata as blockers, never as unpublished versions", async () => {
  for (const fetch of [
    async () => { throw new Error("offline"); },
    async () => new Response("unauthorized", { status: 401 }),
    async () => new Response("not found", { status: 404 }),
    async () => new Response("not json"),
    async () => Response.json({ name: "goribu", versions: {} }),
  ]) {
    const state = registry();
    await expect(release(["publish", artifacts], { ...state.options, fetch })).rejects.toThrow(/\[Goribu\].*(metadata|JSON)/);
    expect(state.mutations).toEqual([]);
  }
}, 30000);

it("stops after an unconfirmed upload and keeps the original archives for a later retry", async () => {
  const state = registry();
  let uploaded = false;
  const run = (bin, args, opts) => {
    if (bin === "npm" && args[0] === "publish") {
      uploaded = true;
      // Simulate an accepted upload whose metadata has not propagated yet.
      return "";
    }
    return state.options.run(bin, args, opts);
  };
  await expect(release(["publish", artifacts], { ...state.options, run })).rejects.toThrow(/not yet visible.*same directory/);
  expect(uploaded).toBe(true);
  expect(state.mutations).toEqual([]);
  expect(state.data.goribu["dist-tags"].alpha).toBe("0.1.0-alpha.9");
  expect(JSON.parse(readFileSync(join(artifacts, "release.json"), "utf8"))).toEqual(receipt);
}, 15000);
