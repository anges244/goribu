import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { expect, it } from "vitest";
import { goribu } from "goribu/vite";
import { runLocalClear } from "../src/build/run-local-clear.js";

const fixture = fileURLToPath(new URL("../../../fixtures/basic-app", import.meta.url));

it("clears the local R2 and KV data a running dev server uses, by prefix or entirely", async () => {
  const root = mkdtempSync(join(tmpdir(), "goribu-local-clear-"));
  let server;
  try {
    cpSync(join(fixture, "src"), join(root, "src"), { recursive: true });
    cpSync(join(fixture, "package.json"), join(root, "package.json"));
    symlinkSync(join(fixture, "node_modules"), join(root, "node_modules"), "dir");
    writeFileSync(join(root, "goribu.config.js"), `import { defineConfig } from "goribu/server";
export default defineConfig({ name: "local-clear", compatibilityDate: "2026-09-01",
  kv: { name: "local-clear-kv" }, r2: { name: "local-clear-media", domain: "media.example.com", private: { name: "local-clear-files" } } });`);
    writeFileSync(join(root, "src/routes/local-data.js"), `
export async function PUT(req, res) {
  for (const key of ["avatars/a.png", "avatars/b.png", "docs/c.txt"]) await req.r2.put(key, key);
  await req.r2.private.put("avatars/p.png", "private");
  for (const key of ["avatars:1", "session:2"]) await req.kv.put(key, key);
  return res.json({ stored: true });
}
export async function GET(req, res) {
  return res.json({
    media: (await req.r2.list()).objects.map((object) => object.key),
    files: (await req.r2.private.list()).objects.map((object) => object.key),
    kv: (await req.kv.list()).keys.map((key) => key.name),
  });
}
`);
    server = await createServer({ root, cacheDir: join(root, ".vite-cache"), configFile: false, logLevel: "silent", plugins: [goribu()], server: { host: "127.0.0.1", port: 0 } });
    await server.listen();
    const url = new URL("/local-data", server.resolvedUrls.local[0]);
    const read = async () => (await fetch(url)).json();
    const clear = async (target, prefix) => {
      let output = "";
      await runLocalClear({ projectRoot: root, target, prefix, stdout: { write(text) { output += text; } } });
      return output;
    };

    expect(await (await fetch(url, { method: "PUT" })).json()).toEqual({ stored: true });
    expect(await clear("r2", "avatars/")).toBe(
      'Deleted 2 objects under "avatars/" from local R2 bucket local-clear-media.\n' +
      'Deleted 1 object under "avatars/" from local R2 bucket local-clear-files.\n',
    );
    expect(await clear("kv", "avatars:")).toBe('Deleted 1 key under "avatars:" from local KV namespace local-clear-kv.\n');
    expect(await read()).toEqual({ media: ["docs/c.txt"], files: [], kv: ["session:2"] });

    expect(await clear("r2")).toBe(
      "Deleted 1 object from local R2 bucket local-clear-media.\nDeleted 0 objects from local R2 bucket local-clear-files.\n",
    );
    expect(await clear("kv")).toBe("Deleted 1 key from local KV namespace local-clear-kv.\n");
    expect(await read()).toEqual({ media: [], files: [], kv: [] });

    // The dev server keeps working against the cleared stores.
    await fetch(url, { method: "PUT" });
    expect(await read()).toEqual({ media: ["avatars/a.png", "avatars/b.png", "docs/c.txt"], files: ["avatars/p.png"], kv: ["avatars:1", "session:2"] });
  } finally {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
