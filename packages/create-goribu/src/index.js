import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const HELP = `Usage: create-goribu <project-name> [--goribu-tarball <path>]

Creates a new JavaScript app with Tailwind. The directory must not exist.
Project names: 1–50 lowercase letters, digits or hyphens, starting with a letter.

  --goribu-tarball <path>  Use a local packed Goribu .tgz for development.
  --help, -h              Show this help.

Does not install dependencies, initialize Git, log in, provision, or deploy.`;

export async function run(argv) {
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) {
    console.log(HELP);
    return;
  }
  let name;
  let tarball;
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === "--goribu-tarball" && tarball === undefined) {
      tarball = argv[++index];
      if (!tarball || tarball.startsWith("-")) throw new Error("[Goribu] --goribu-tarball needs a file path. Pass the .tgz produced by pnpm pack.");
    } else if (!value.startsWith("-") && name === undefined) {
      name = value;
    } else {
      throw new Error(`[Goribu] Unexpected argument ${JSON.stringify(value)}. Run create-goribu --help; only JavaScript output is supported.`);
    }
  }
  if (!name || !/^[a-z][a-z0-9-]{0,49}$/.test(name)) {
    throw new Error("[Goribu] Supply a project name with 1–50 lowercase letters, digits or hyphens, starting with a letter. Use a name such as my-app, not a directory path.");
  }

  let template;
  try {
    template = JSON.parse(await readFile(new URL("../dist/template.json", import.meta.url), "utf8"));
  } catch (cause) {
    throw new Error("[Goribu] The packaged starter is missing or unreadable. In the source repository run pnpm --dir packages/create-goribu run build; for a packed CLI, obtain a complete package and retry.", { cause });
  }
  let goribuSpec = template.goribuVersion;
  if (tarball !== undefined) {
    try {
      const path = await realpath(resolve(tarball));
      const info = await stat(path);
      if (!path.endsWith(".tgz") || !info.isFile() || info.size === 0) throw new Error("not a non-empty .tgz file");
      goribuSpec = `file:${path}`;
    } catch (cause) {
      throw new Error(`[Goribu] Cannot use Goribu tarball ${JSON.stringify(tarball)}. Pass an existing, non-empty .tgz produced by pnpm pack.`, { cause });
    }
  } else if (!goribuSpec || goribuSpec === "0.0.0") {
    throw new Error("[Goribu] This rebuild is unpublished. Pack packages/goribu and pass --goribu-tarball <path>; the older npm release is not compatible with this starter.");
  }

  // Prepare everything before creating the destination. The embedded snapshot
  // makes a packed CLI independent of the source repository and preserves dotfiles.
  const files = new Map(Object.entries(template.files).map(([path, data]) => {
    if (path.split("/").some((part) => !part || part === "." || part === "..") || path.includes("\\") || path.includes(":")) {
      throw new Error("[Goribu] The packaged starter contains an unsafe path. Rebuild or obtain a complete create-goribu package before retrying.");
    }
    return [path, Buffer.from(data, "base64")];
  }));
  const pkg = JSON.parse(files.get("package.json").toString());
  pkg.name = name;
  pkg.dependencies.goribu = goribuSpec;
  files.set("package.json", JSON.stringify(pkg, null, 2) + "\n");
  const config = files.get("goribu.config.js").toString();
  if (!config.includes('name: "goribu-starter"')) {
    throw new Error("[Goribu] The starter's naming convention changed. Update create-goribu's config substitution and rebuild its template before retrying.");
  }
  files.set("goribu.config.js", config.replaceAll("goribu-starter", name));
  const readme = files.get("README.md").toString();
  const repositorySection = /<!-- repository-only:start -->[\s\S]*?<!-- repository-only:end -->\n*/;
  if (!repositorySection.test(readme)) {
    throw new Error("[Goribu] The starter README is missing its repository-only markers. Restore them and rebuild create-goribu before retrying.");
  }
  files.set("README.md", readme.replace(repositorySection, ""));
  files.set("pnpm-workspace.yaml", "packages:\n  - .\n\nonlyBuiltDependencies:\n  - esbuild\n  - workerd\n");

  const target = resolve(name);
  try {
    // Exclusive creation rejects existing directories, files and symlinks.
    // There is no force mode and no cleanup that could erase someone else's work.
    await mkdir(target);
  } catch (cause) {
    throw new Error(`[Goribu] Cannot create ${JSON.stringify(target)}. Choose a new directory name; existing files, directories and symlinks are never overwritten.`, { cause });
  }
  for (const [path, content] of files) {
    const output = resolve(target, path);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, content, { flag: "wx" });
  }
  console.log(`\n[Goribu] Created ${name} (JavaScript + Tailwind).\n\n  cd ${name}\n  pnpm install\n  pnpm dev\n\nWhen ready, review goribu.config.js, then run pnpm check and pnpm run deploy.\nNothing was installed, initialized in Git, or deployed.`);
}
