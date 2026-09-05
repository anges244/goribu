import { mkdir, readdir, readFile, writeFile, lstat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../../../templates/basic-app/", import.meta.url));
const output = fileURLToPath(new URL("../dist/template.json", import.meta.url));
const framework = JSON.parse(await readFile(new URL("../../goribu/package.json", import.meta.url), "utf8"));
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
for (const path of [".gitignore", "AGENTS.md", "README.md", "package.json", "goribu.config.js", "vite.config.js", "src"]) {
  await collect(path);
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ goribuVersion: framework.version, files }, null, 2) + "\n");
console.log("[Goribu] Packaged the canonical JavaScript starter.");
