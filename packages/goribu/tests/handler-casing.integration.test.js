import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestHarness } from "wrangler";
import { expect, it } from "vitest";

const fixture = fileURLToPath(new URL("../../../fixtures/basic-app", import.meta.url));
const cli = fileURLToPath(new URL("../bin/goribu.js", import.meta.url));

it("rejects a lowercase handler in dev and build, then dispatches the corrected production POST", async () => {
  const root = mkdtempSync(join(tmpdir(), "goribu-handler-casing-"));
  let harness;
  try {
    cpSync(join(fixture, "src"), join(root, "src"), { recursive: true });
    for (const name of ["package.json", "goribu.config.js", "vite.config.js"]) {
      cpSync(join(fixture, name), join(root, name));
    }
    symlinkSync(join(fixture, "node_modules"), join(root, "node_modules"), "dir");
    const route = join(root, "src/routes/items.jsx");
    const source = `
      export default function Page() { return <h1>Items</h1>; }
      export function post(req, res) { return res.status(201).json({ created: true }); }
    `;
    writeFileSync(route, source);
    writeFileSync(join(root, "src/routes/types.tsx"), `
      export namespace post { export type Payload = { title: string }; }
      namespace Types { export interface Payload { title: string } }
      export { Types as Get, Types as POST };
      export default function Page() { return <h1>Type-only namespaces</h1>; }
    `);

    function run(command) {
      const result = spawnSync(process.execPath, [cli, command], {
        cwd: root, encoding: "utf8", timeout: 100000,
        env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
      });
      expect(result.error).toBeUndefined();
      return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
    }

    for (const command of ["dev", "build"]) {
      const result = run(command);
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain(
        '[Goribu] Route "src/routes/items.jsx" exports "post". HTTP handlers must use uppercase names. Rename "post" to "POST".',
      );
      expect(existsSync(join(root, ".goribu/dist/client/items.html"))).toBe(false);
    }

    writeFileSync(route, source.replace("function post", "function POST"));
    const corrected = run("build");
    expect(corrected.status, corrected.output).toBe(0);
    expect(existsSync(join(root, ".goribu/dist/client/items.html"))).toBe(false);
    expect(existsSync(join(root, ".goribu/dist/client/types.html"))).toBe(true);

    harness = createTestHarness({
      workers: [{ configPath: join(root, ".goribu/dist/goribu_basic_app/wrangler.json") }],
    });
    const { url } = await harness.listen();
    const response = await fetch(new URL("/items", url), { method: "POST" });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ created: true });
    const types = await fetch(new URL("/types", url));
    expect(types.status).toBe(200);
    expect(await types.text()).toContain("<h1>Type-only namespaces</h1>");
  } finally {
    await harness?.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 120000);
