import { mkdir, readdir, readFile, writeFile, lstat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../../../templates/basic-app/", import.meta.url));
const output = fileURLToPath(new URL("../dist/template.json", import.meta.url));
const framework = JSON.parse(await readFile(new URL("../../goribu/package.json", import.meta.url), "utf8"));
const scaffolder = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

// A published starter must select the framework from the same release.
if (framework.version !== scaffolder.version ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(framework.version) ||
    framework.version === "0.0.0") {
  throw new Error(`[Goribu] Cannot package create-goribu@${scaffolder.version} with goribu@${framework.version}. Set both package versions to the same nonzero release version (major.minor.patch, without a prerelease suffix), then rebuild the template.`);
}
const files = {};

async function collect(relativePath) {
  const path = join(source, relativePath);
  const stat = await lstat(path);
  if (stat.isDirectory()) {
    for (const name of (await readdir(path)).sort()) await collect(`${relativePath}/${name}`);
  } else if (stat.isFile()) {
    files[relativePath] = (await readFile(path)).toString("base64");
  } else {
    throw new Error(`[Goribu] Cannot package template entry ${relativePath}. Replace symlinks or special files with ordinary source files.`);
  }
}

// Only app-owned source is distributable. Never copy installed dependencies,
// generated output, local credentials, resource state, or a workspace lockfile.
for (const path of [".gitignore", "AGENTS.md", "README.md", "package.json", "goribu.config.js", "vite.config.js", "tsconfig.json", "src", "public"]) {
  await collect(path);
}
let javascriptPackage;
try {
  javascriptPackage = JSON.parse(Buffer.from(files["package.json"], "base64").toString("utf8"));
} catch (cause) {
  throw new Error("[Goribu] Cannot package the starter because templates/basic-app/package.json is not valid JSON. Restore valid JSON in that file before packaging.", { cause });
}
for (const field of ["scripts", "devDependencies"]) {
  const value = javascriptPackage?.[field];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`[Goribu] Cannot package the starter because templates/basic-app/package.json must contain a ${field} object. Restore the ${field} map in that file before packaging.`);
  }
}
// Conversion belongs to packaging. The published CLI has no compiler dependency.
const { default: ts } = await import("typescript");
const { transform } = await import("sucrase");
const { format } = await import("prettier");
const javascript = {};
const javascriptPath = (path) => path.replace(/\.tsx$/, ".jsx").replace(/\.ts$/, ".js");
const renamed = Object.keys(files).filter((path) => !path.startsWith("public/") && javascriptPath(path) !== path);
for (const [path, encoded] of Object.entries(files)) {
  // Public assets keep their names and bytes in both language variants.
  if (path.startsWith("public/")) {
    javascript[path] = encoded;
    continue;
  }
  if (path === "tsconfig.json" || path.endsWith(".d.ts")) continue;
  let content = Buffer.from(encoded, "base64").toString("utf8");
  if (/\.tsx?$/.test(path)) {
    const result = ts.transpileModule(content, {
      fileName: path,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.Preserve,
        verbatimModuleSyntax: true,
        rewriteRelativeImportExtensions: true,
      },
    });
    const errors = result.diagnostics.filter((item) => item.category === ts.DiagnosticCategory.Error);
    if (errors.length) {
      throw new Error(`[Goribu] Cannot generate JavaScript from ${path}. Fix the TypeScript starter before packaging:\n${ts.formatDiagnosticsWithColorAndContext(errors, {
        getCurrentDirectory: () => source, getCanonicalFileName: (name) => name, getNewLine: () => "\n",
      })}`);
    }
    // The TypeScript printer discards authored blank lines. Keep its diagnostics,
    // but strip types without losing line boundaries before formatting the JSX.
    try {
      content = transform(content, {
        filePath: path,
        transforms: ["typescript", "jsx"],
        jsxRuntime: "preserve",
        disableESTransforms: true,
        keepUnusedImports: true,
      }).code;
      content = await format(content, { parser: "babel", tabWidth: 2, printWidth: 80 });
    } catch (cause) {
      throw new Error(`[Goribu] Cannot prepare readable JavaScript from ${path}. Fix the TypeScript starter before packaging: ${cause.message}`, { cause });
    }
  }
  // Keep displayed edit paths synchronized with the generated filenames.
  for (const renamedPath of renamed) content = content.replaceAll(renamedPath, javascriptPath(renamedPath));
  if (path.endsWith(".md")) {
    content = content.replace(/<!-- typescript-only:start -->[\s\S]*?<!-- typescript-only:end -->\n*/g, "")
      .replaceAll(".tsx", ".jsx").replaceAll(".server.ts", ".server.js");
  }
  if (path === "package.json") {
    delete javascriptPackage.scripts.typecheck;
    for (const dependency of ["typescript", "@types/node", "@types/react", "@types/react-dom"]) delete javascriptPackage.devDependencies[dependency];
    content = JSON.stringify(javascriptPackage, null, 2) + "\n";
  }
  const destination = javascriptPath(path);
  if (Object.hasOwn(javascript, destination)) {
    throw new Error(`[Goribu] Two starter files generate ${destination}. Rename the conflicting source files before packaging.`);
  }
  javascript[destination] = Buffer.from(content).toString("base64");
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ schema: 1, goribuVersion: framework.version, templates: { typescript: files, javascript } }, null, 2) + "\n");
console.log("[Goribu] Packaged TypeScript and JavaScript from the canonical TypeScript starter.");
