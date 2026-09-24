import { mkdir, open, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { HELP, parseArguments } from "./arguments.js";

export async function run(argv) {
  const { help, name, tarball, language } = parseArguments(argv);
  if (help) {
    console.log(HELP);
    return;
  }
  let template;
  try {
    template = JSON.parse(await readFile(new URL("../dist/template.json", import.meta.url), "utf8"));
  } catch (cause) {
    throw packageError("The packaged starter is missing or unreadable.", cause);
  }
  if (template?.schema !== 1 || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(template?.goribuVersion) || template.goribuVersion === "0.0.0") {
    throw packageError("The packaged starter has invalid release metadata.");
  }
  let goribuSpec = template.goribuVersion;
  if (tarball !== undefined) {
    if (!tarball.endsWith(".tgz")) {
      throw new Error(`[Goribu] Local Goribu archive ${JSON.stringify(tarball)} must end in .tgz.\nPass the archive produced by pnpm pack.`);
    }
    try {
      const path = await realpath(resolve(tarball));
      const info = await stat(path);
      if (!info.isFile() || info.size === 0) {
        throw new Error(`[Goribu] Local Goribu archive ${JSON.stringify(tarball)} is empty or is not a regular file.\nPass the non-empty .tgz produced by pnpm pack.`);
      }
      // Probe readability without buffering, installing, or executing the archive.
      const handle = await open(path, "r");
      try {
        await handle.read({ buffer: Buffer.alloc(1), length: 1, position: 0 });
      } finally {
        await handle.close();
      }
      goribuSpec = `file:${path}`;
    } catch (cause) {
      if (cause.message?.startsWith("[Goribu]")) throw cause;
      if (cause.code === "ENOENT") {
        throw new Error(`[Goribu] Local Goribu archive ${JSON.stringify(tarball)} was not found.\nCheck the path relative to ${JSON.stringify(process.cwd())}, or pass an absolute path.`, { cause });
      }
      throw filesystemError("read the local Goribu archive", resolve(tarball), cause);
    }
  }

  // Validate and prepare all output before exclusively creating the destination.
  const files = prepareFiles(template.templates?.[language], { name, goribuSpec, language });
  const target = resolve(name);
  try {
    await mkdir(target);
  } catch (cause) {
    if (cause.code === "EEXIST") {
      throw new Error(`[Goribu] Cannot create ${JSON.stringify(target)}: the target already exists.\nChoose another project name. Existing files, directories and symlinks are never overwritten.`, { cause });
    }
    throw filesystemError("create the project directory", target, cause);
  }
  for (const [path, content] of files) {
    const output = resolve(target, path);
    try {
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, content, { flag: "wx" });
    } catch (cause) {
      const error = filesystemError("write a starter file", output, cause);
      throw new Error(`${error.message}\nThe incomplete app was preserved at ${JSON.stringify(target)}. Inspect it, then retry with a new project name.`, { cause });
    }
  }
  const label = language === "typescript" ? "TypeScript" : "JavaScript";
  console.log(`\n[Goribu] Created ${name} (${label} + Tailwind).\n\n  cd ${name}\n  pnpm install\n${language === "typescript" ? "  pnpm typecheck\n" : ""}  pnpm dev\n\nWhen ready, review goribu.config.js, then run pnpm check and pnpm run deploy.\nNothing was installed, initialized in Git, or deployed.`);
}

function prepareFiles(input, { name, goribuSpec, language }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw packageError(`The packaged ${language} starter is missing.`);
  const files = new Map();
  for (const [path, data] of Object.entries(input)) {
    if (path.split("/").some((part) => !part || part === "." || part === "..") || path.includes("\\") || path.includes(":")) {
      throw packageError("The packaged starter contains an unsafe file path.");
    }
    if (typeof data !== "string" || Buffer.from(data, "base64").toString("base64") !== data) {
      throw packageError(`The packaged starter file ${JSON.stringify(path)} is corrupt.`);
    }
    files.set(path, Buffer.from(data, "base64"));
  }
  const extension = language === "typescript" ? "tsx" : "jsx";
  const required = ["package.json", "README.md", "AGENTS.md", ".gitignore", "goribu.config.js", "vite.config.js", "src/setup/client-entry.js", "src/styles/global.css",
    `src/setup/_document.${extension}`, ...["index", "hello"].map((name) => `src/routes/${name}.${extension}`), ...(language === "typescript" ? ["tsconfig.json"] : [])];
  for (const path of required) {
    if (!files.has(path)) throw packageError(`The packaged starter is missing ${JSON.stringify(path)}.`);
  }
  let pkg;
  try { pkg = JSON.parse(files.get("package.json").toString()); }
  catch (cause) { throw packageError("The starter package.json is invalid.", cause); }
  if (!pkg || typeof pkg.dependencies !== "object" || !pkg.dependencies || Array.isArray(pkg.dependencies)) {
    throw packageError("The starter package.json has no valid dependency map.");
  }
  pkg.name = name;
  pkg.dependencies.goribu = goribuSpec;
  files.set("package.json", JSON.stringify(pkg, null, 2) + "\n");
  const config = files.get("goribu.config.js").toString();
  if (!config.includes('name: "goribu-starter"')) throw packageError("The packaged starter has an invalid Worker naming placeholder.");
  files.set("goribu.config.js", config.replaceAll("goribu-starter", name));
  const readme = files.get("README.md").toString();
  const repositorySection = /<!-- repository-only:start -->[\s\S]*?<!-- repository-only:end -->\n*/;
  if (!repositorySection.test(readme)) throw packageError("The packaged starter README is incomplete.");
  files.set("README.md", readme.replace(repositorySection, ""));
  files.set("pnpm-workspace.yaml", "packages:\n  - .\n\nonlyBuiltDependencies:\n  - esbuild\n  - workerd\n");
  return files;
}

function packageError(problem, cause) {
  return new Error(`[Goribu] ${problem}\nRetry with npx create-goribu@latest. If it persists, report the command and package version at https://github.com/anges244/goribu/issues.\nThis is a scaffolder package problem; no project files were created.`, { cause });
}

function filesystemError(action, path, cause) {
  const repair = cause.code === "EACCES" || cause.code === "EPERM"
    ? "Check permissions for this path or choose an accessible location."
    : cause.code === "ENOSPC" ? "Free disk space and retry."
    : cause.code === "EROFS" ? "Choose a location on a writable filesystem."
    : cause.code === "EEXIST" ? "An existing file blocked creation. Inspect the target and choose a new project name."
    : "Check the reported filesystem error and retry after resolving it.";
  return new Error(`[Goribu] Cannot ${action} at ${JSON.stringify(path)}: ${cause.code ?? cause.message}.\n${repair}`, { cause });
}
