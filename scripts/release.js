import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const REGISTRY = "https://registry.npmjs.org/";
const NAMES = ["goribu", "create-goribu"];
const HELP = `Usage: pnpm release <command> <value>

  prepare <version>     Set both versions and rebuild the starter template.
  pack <new-directory>  Test a clean checkout and save audited release archives.
  publish <directory>   Publish those saved archives to latest, framework first.

Use a release directory outside the repository. Review and independently test
its archives before publish. No command installs dependencies or creates commits.`;

function fail(message) { throw new Error(`[Goribu] ${message}`); }
function json(text, label) {
  try { return JSON.parse(text); }
  catch { fail(`Cannot read JSON from ${label}. Restore valid data and retry.`); }
}
function readJson(path) { return json(readFileSync(path, "utf8"), path); }
function integrity(path) { return `sha512-${createHash("sha512").update(readFileSync(path)).digest("base64")}`; }

function runCommand(bin, args, { cwd, inherit = false } = {}) {
  const result = spawnSync(bin, args, {
    cwd, encoding: "utf8", stdio: inherit ? "inherit" : "pipe",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    fail(`${bin} ${args[0]} failed${result.error ? `: ${result.error.message}` : ` (exit ${result.status})`}. Fix the reported problem${inherit ? "" : `: ${result.stderr?.trim() || "check that the command is installed and accessible"}`}, then retry the release command.${bin === "npm" ? ` For npm authentication, run npm login --registry=${REGISTRY}.` : ""}`);
  }
  return result.stdout ?? "";
}

function releaseVersion(version) {
  if (typeof version !== "string" || version.length > 64 ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || version === "0.0.0" ||
      version.split(".").some((part) => !Number.isSafeInteger(Number(part)))) {
    fail(`Invalid release version ${JSON.stringify(version)}. Use a nonzero major.minor.patch version without prerelease or build suffixes.`);
  }
  return version;
}

// The target is always a plain release. Only the registry's predecessor may
// have a prerelease suffix; equal numeric parts then precede the target.
function assertNotOlder(target, previous) {
  const match = typeof previous === "string" && previous.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) fail(`Cannot compare version ${JSON.stringify(previous)}. Inspect the package versions before releasing.`);
  const parts = target.split(".").map(BigInt);
  for (let index = 0; index < 3; index++) {
    const old = BigInt(match[index + 1]);
    if (parts[index] > old) return;
    if (parts[index] < old) fail(`Release ${target} is older than ${previous}. Choose a newer version; latest will not be moved backwards.`);
  }
}

function validatePackage(pkg, name, version) {
  if (pkg.name !== name || pkg.version !== version || pkg.private || pkg.license !== "MIT" ||
      pkg.publishConfig?.tag !== "latest" || pkg.publishConfig?.access !== "public" ||
      pkg.publishConfig?.registry !== REGISTRY || pkg.bin?.[name] !== `./bin/${name}.js` ||
      pkg.repository?.directory !== `packages/${name}` || !pkg.repository?.url || !pkg.homepage) {
    fail(`Invalid release metadata for ${name}. Restore the matching version, public latest registry settings, repository, homepage, MIT license, and CLI entry before retrying.`);
  }
  for (const group of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    if (Object.values(pkg[group] ?? {}).some((spec) => /^(?:workspace:|file:|link:)/.test(spec))) {
      fail(`${name} has a local ${group} reference. Replace it with a registry dependency before releasing.`);
    }
  }
}

function packages(root) {
  const manifests = NAMES.map((name) => readJson(join(root, "packages", name, "package.json")));
  const version = releaseVersion(manifests[0].version);
  manifests.forEach((pkg, index) => validatePackage(pkg, NAMES[index], version));
  return { version, manifests };
}

function cleanCommit(io) {
  if (io.run("git", ["status", "--porcelain", "--untracked-files=all"]).trim()) {
    fail("The checkout has uncommitted changes. Review and commit them before packing or publishing; release commands never commit for you.");
  }
  const commit = io.run("git", ["rev-parse", "HEAD"]).trim();
  if (!/^[a-f0-9]{40,64}$/.test(commit)) fail("Cannot identify the source commit. Run from the Goribu Git checkout and retry.");
  return commit;
}

function assertCommit(io, commit) {
  if (cleanCommit(io) !== commit) fail(`The source commit changed. Return to ${commit} or pack a new release directory after review.`);
}

function releaseDirectory(root, path, create) {
  // Resolve the parent first so a symlink cannot place artifacts in source.
  const requested = resolve(path);
  const directory = create ? join(realpathSync(dirname(requested)), basename(requested)) : realpathSync(requested);
  const fromRoot = relative(realpathSync(root), directory);
  if (!fromRoot || (!fromRoot.startsWith("../") && fromRoot !== "..")) {
    fail("The release directory is inside the repository. Choose a new sibling directory so artifacts cannot enter source or its test scan.");
  }
  if (create) {
    try { mkdirSync(directory); }
    catch { fail(`Cannot create ${directory}. Choose a new directory in an existing parent; existing release artifacts are never overwritten.`); }
  }
  return directory;
}

function archiveJson(io, archive, path) {
  return json(io.run("tar", ["-xOf", archive, `package/${path}`]), `${archive}:${path}`);
}

function auditArchive(io, archive, name, version) {
  if (!lstatSync(archive).isFile()) fail(`Archive ${archive} is not an ordinary file. Restore the saved release archive and retry.`);
  const report = json(io.run("npm", ["pack", archive, "--dry-run", "--ignore-scripts", "--json"]), "npm pack --dry-run");
  const digest = integrity(archive);
  if (!Array.isArray(report) || report.length !== 1 || report[0].name !== name ||
      report[0].version !== version || report[0].integrity !== digest || !Array.isArray(report[0].files)) {
    fail(`Cannot verify ${name}'s archive identity. Pack a fresh release directory and review it.`);
  }
  const prefix = `packages/${name}/`;
  const sourceFiles = io.run("git", ["ls-files", "-z", "--", `${prefix}bin`, `${prefix}src`])
    .split("\0").filter(Boolean).map((path) => path.slice(prefix.length));
  const expected = new Set([...sourceFiles, "package.json", "README.md", "LICENSE"]);
  if (name === "create-goribu") expected.add("dist/template.json");
  const files = new Map(report[0].files.map((file) => [file.path, file]));
  if (files.size !== report[0].files.length || files.size !== expected.size ||
      [...files.keys()].some((path) => !expected.has(path)) ||
      !(files.get(`bin/${name}.js`)?.mode & 0o111)) {
    fail(`Unexpected or missing files in ${name}'s archive. Keep only the tracked bin/src files, package metadata, README, license, and the scaffolder template; retain executable CLI permissions.`);
  }
  for (const path of sourceFiles) {
    if (!lstatSync(join(io.root, prefix, path)).isFile()) fail(`Source ${prefix}${path} is not an ordinary file. Replace symlinks before releasing.`);
  }
  const pkg = archiveJson(io, archive, "package.json");
  validatePackage(pkg, name, version);
  if (name === "goribu") {
    for (const entry of [".", "./server", "./client", "./vite"]) {
      if (!files.has(pkg.exports?.[entry]?.default?.replace(/^\.\//, "")) ||
          !files.has(pkg.exports?.[entry]?.types?.replace(/^\.\//, ""))) {
        fail(`Missing runtime or type export for ${entry} in the framework archive. Restore both public entry files and repack.`);
      }
    }
  } else if (archiveJson(io, archive, "dist/template.json").goribuVersion !== version) {
    fail("The packaged template selects a different framework version. Rebuild and repack both packages.");
  }
  if (io.run("tar", ["-xOf", archive, "package/LICENSE"]) !== readFileSync(join(io.root, "LICENSE"), "utf8")) {
    fail(`The ${name} archive lacks the canonical MIT license. Restore the root license and repack with pnpm.`);
  }
  if (io.run("tar", ["-xOf", archive, "package/README.md"]).includes("**Release preparation:**")) {
    fail(`The ${name} README still contains release-preparation instructions. Finalize the package README before freezing release archives.`);
  }
  return { name, filename: `${name}-${version}.tgz`, integrity: digest };
}

function smokeScaffolder(io, archive, version) {
  const directory = mkdtempSync(join(tmpdir(), "goribu-release-smoke-"));
  try {
    io.run("tar", ["-xzf", archive, "-C", directory]);
    for (const [name, flags] of [["release-smoke-ts", []], ["release-smoke-js", ["--js"]]]) {
      io.run(process.execPath, [join(directory, "package/bin/create-goribu.js"), name, ...flags], { cwd: directory });
      if (readJson(join(directory, name, "package.json")).dependencies?.goribu !== version) {
        fail("The saved scaffolder does not generate the matching framework dependency. Fix the generator and repack.");
      }
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

async function registryState(io, name, version, digest) {
  let response;
  try { response = await io.fetch(`${REGISTRY}${name}`, { cache: "no-store", signal: AbortSignal.timeout(15000) }); }
  catch { fail(`Cannot read npm metadata for ${name}. Check connectivity and retry; registry uncertainty never means a version is unpublished.`); }
  if (!response.ok) fail(`npm metadata for ${name} returned HTTP ${response.status}. Repair registry access and retry before publishing.`);
  let data;
  try { data = await response.json(); }
  catch { fail(`npm returned unreadable metadata for ${name}. Retry when the registry serves valid JSON.`); }
  const latest = data?.["dist-tags"]?.latest;
  if (data?.name !== name || !data.versions || typeof data.versions !== "object" || Array.isArray(data.versions) ||
      data.versions[latest]?.name !== name || data.versions[latest]?.version !== latest) {
    fail(`npm metadata for ${name} is incomplete. Inspect its versions and latest tag before retrying.`);
  }
  assertNotOlder(version, latest);
  const exists = Object.hasOwn(data.versions, version);
  const published = data.versions[version];
  if (exists && (published?.name !== name || published?.version !== version || published?.dist?.integrity !== digest)) {
    fail(`${name}@${version} already exists with different or unverifiable bytes. Restore the original release archives, or choose a new shared version; published versions cannot be overwritten.`);
  }
  if (version === "0.7.0" && name === "goribu" && data["dist-tags"].alpha !== undefined && data["dist-tags"].alpha !== "0.1.0-alpha.9") {
    fail("Goribu's alpha tag no longer points to the known predecessor. Inspect it before retrying; the release command will not remove an unexpected tag.");
  }
  return { published: exists, latest, alpha: data["dist-tags"].alpha };
}

async function publish(io, directory) {
  const receipt = readJson(join(directory, "release.json"));
  const version = releaseVersion(receipt.version);
  if (receipt.schema !== 1 || !/^[a-f0-9]{40,64}$/.test(receipt.commit) ||
      !Array.isArray(receipt.packages) || receipt.packages.length !== 2) {
    fail("Invalid release receipt. Use an unmodified directory completed by pnpm release pack.");
  }
  assertCommit(io, receipt.commit);
  if (packages(io.root).version !== version) fail("The checkout and release receipt have different versions. Return to the recorded release commit.");
  // Publish private copies of the reviewed bytes, so edits to the supplied
  // directory during a two-package publish cannot change the second upload.
  const snapshot = mkdtempSync(join(tmpdir(), "goribu-publish-"));
  try {
    const artifacts = NAMES.map((name, index) => {
      const item = receipt.packages[index];
      const filename = `${name}-${version}.tgz`;
      if (item?.name !== name || item.filename !== filename || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(item.integrity)) {
        fail("The release receipt has invalid package identities or hashes. Restore it from the original packing run.");
      }
      const source = join(directory, filename);
      if (!lstatSync(source).isFile()) fail(`Release archive ${filename} is not an ordinary file. Restore the reviewed archive.`);
      const archive = join(snapshot, filename);
      copyFileSync(source, archive);
      if (integrity(archive) !== item.integrity) fail(`Release archive ${filename} changed after packing. Restore the reviewed bytes or pack a new release directory.`);
      auditArchive(io, archive, name, version);
      return { ...item, archive };
    });
    // Check both names before the first mutation, then refresh each immediately
    // before acting. Never treat authentication, network, or JSON failures as absence.
    for (const item of artifacts) await registryState(io, item.name, version, item.integrity);
    io.run("npm", ["whoami", `--registry=${REGISTRY}`]);
    for (const item of artifacts) {
      assertCommit(io, receipt.commit);
      let state = await registryState(io, item.name, version, item.integrity);
      if (!state.published) {
        io.log(`[Goribu] Publishing ${item.name}@${version} to latest.`);
        io.run("npm", ["publish", item.archive, "--ignore-scripts", "--workspaces=false", "--access=public", "--tag=latest", `--registry=${REGISTRY}`], { inherit: true });
        state = await registryState(io, item.name, version, item.integrity);
        if (!state.published) fail(`${item.name}@${version} is not yet visible on npm. Wait for registry propagation and rerun publish with the same directory.`);
      }
      if (state.latest !== version) {
        io.run("npm", ["dist-tag", "add", `${item.name}@${version}`, "latest", `--registry=${REGISTRY}`], { inherit: true });
      }
      state = await registryState(io, item.name, version, item.integrity);
      if (!state.published || state.latest !== version) fail(`npm has not confirmed ${item.name}@${version} as latest. Retry publish with the same directory after checking registry state.`);
      io.log(`[Goribu] Verified ${item.name}@${version}: saved bytes match npm and latest.`);
    }
    // One-time retirement of the known predecessor's extra channel, only after
    // both matching releases are verified. A failed cleanup is safe to retry.
    const states = [];
    for (const item of artifacts) states.push(await registryState(io, item.name, version, item.integrity));
    if (states.some((state) => !state.published || state.latest !== version)) fail("The release tags changed during publication. Inspect npm and retry with the same directory.");
    if (version === "0.7.0" && states[0].alpha) {
      io.run("npm", ["dist-tag", "rm", "goribu", "alpha", `--registry=${REGISTRY}`], { inherit: true });
      if ((await registryState(io, "goribu", version, artifacts[0].integrity)).alpha) fail("npm has not confirmed alpha tag removal. Retry publish with the same directory.");
    }
    io.log(`[Goribu] Both ${version} packages are published on latest. Verify a fresh registry-generated app and update the live guide.`);
  } finally { rmSync(snapshot, { recursive: true, force: true }); }
}

export async function release(argv, { root = ROOT, run = runCommand, fetch = globalThis.fetch, log = console.log } = {}) {
  if (!argv.length || (argv.length === 1 && argv[0] === "--help")) { log(HELP); return; }
  const [action, value] = argv;
  if (argv.length !== 2 || !["prepare", "pack", "publish"].includes(action) || !value || value.startsWith("-")) fail(`Invalid release arguments. ${HELP}`);
  const io = { root, fetch, log, run: (bin, args, options) => run(bin, args, { cwd: root, ...options }) };
  if (action === "prepare") {
    const next = releaseVersion(value);
    const { version, manifests } = packages(root);
    assertNotOlder(next, version);
    if (next !== version) {
      manifests.forEach((pkg, index) => writeFileSync(join(root, "packages", NAMES[index], "package.json"), JSON.stringify({ ...pkg, version: next }, null, 2) + "\n"));
    }
    io.run(process.execPath, [join(root, "packages/create-goribu/scripts/build-template.js")], { inherit: true });
    log(`[Goribu] Both packages are prepared at ${next}. Review the changelog and package READMEs, then commit before packing. Nothing was published.`);
  } else if (action === "pack") {
    const { version } = packages(root);
    const commit = cleanCommit(io);
    const directory = releaseDirectory(root, value, true);
    io.run("git", ["diff", "--check"]);
    io.run("pnpm", ["test"], { inherit: true });
    assertCommit(io, commit);
    const artifacts = NAMES.map((name) => {
      io.run("pnpm", ["--dir", join(root, "packages", name), "pack", "--pack-destination", directory], { inherit: true });
      return auditArchive(io, join(directory, `${name}-${version}.tgz`), name, version);
    });
    smokeScaffolder(io, join(directory, artifacts[1].filename), version);
    assertCommit(io, commit);
    writeFileSync(join(directory, "release.json"), JSON.stringify({ schema: 1, version, commit, packages: artifacts }, null, 2) + "\n", { flag: "wx" });
    log(`[Goribu] Tested and packed both ${version} archives in ${directory}. Independently install and exercise them before running pnpm release publish with this directory. Nothing was published.`);
  } else {
    await publish(io, releaseDirectory(root, value, false));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  release(process.argv.slice(2)).catch((error) => {
    console.error(error.message?.startsWith("[Goribu]") ? error.message : `[Goribu] Release failed: ${error.message}. Check the supplied paths and permissions, then retry with the original release directory.`);
    process.exitCode = 1;
  });
}
