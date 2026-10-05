import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { goribu } from "goribu/vite";

const fixture = fileURLToPath(new URL("../../../fixtures/basic-app", import.meta.url));
let root;
let server;
let origin;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "goribu-dev-boundary-"));
  cpSync(join(fixture, "src"), join(root, "src"), { recursive: true });
  for (const name of ["package.json", "goribu.config.js"]) cpSync(join(fixture, name), join(root, name));
  symlinkSync(join(fixture, "node_modules"), join(root, "node_modules"), "dir");
  server = await createServer({
    root, configFile: false, logLevel: "silent", plugins: [goribu()],
    cacheDir: join(root, ".vite-cache"), server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = server.resolvedUrls.local[0];
}, 30000);

afterAll(async () => {
  await server?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

it("renders through nested Worker helpers without including them in dev browser code or maps", async () => {
  const document = await fetch(new URL("/server-chain", origin));
  expect(document.status).toBe(200);
  const html = await document.text();
  expect(html).toContain("Server chain: images loaded");
  expect(html).toContain('src="/@vite/client"');
  const response = await fetch(new URL("/src/routes/server-chain.jsx", origin));
  expect(response.status).toBe(200);
  const source = await response.text();
  expect(source).not.toContain("body.server");
  expect(source).not.toContain("readServerMessage");
  const mapData = source.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/)?.[1];
  expect(mapData).toBeDefined();
  const map = Buffer.from(mapData, "base64").toString();
  expect(map).not.toMatch(/body\.server|readServerMessage|NESTED_SERVER_SOURCE/);
  // The page's shared counter goes through a wildcard barrel and a helper
  // exporting `meta`; neither module is a route or may lose its exports.
  for (const [path, exported] of [
    ["/src/routes/_components/index.js", "Counter.jsx"],
    ["/src/routes/_components/Counter.jsx", "Counter"],
    ["/src/routes/_lib/counter.js", "meta"],
  ]) {
    const helper = await fetch(new URL(path, origin));
    expect(helper.status).toBe(200);
    expect(await helper.text()).toContain(exported);
  }
}, 30000);

it("sends the real import error to Vite's browser channel and recovers after repair", async () => {
  const path = join(root, "src/routes/server-chain.jsx");
  const original = readFileSync(path, "utf8");
  const send = vi.spyOn(server.environments.client.hot, "send");
  try {
    writeFileSync(path, original.replace("<h1>{message}</h1>", "<h1>{readServerMessage()}</h1>"));
    await vi.waitFor(async () => {
      const response = await fetch(new URL("/src/routes/server-chain.jsx", origin));
      expect(response.status).toBe(500);
      expect(await response.text()).toContain("body.server.js");
    }, { timeout: 10000 });
    expect(send.mock.calls.some(([payload]) => payload?.type === "error" &&
      /body\.server\.js.*reached client code.*server-chain\.jsx/s.test(payload.err.message))).toBe(true);
    // The overlay entry still loads even though the application page cannot.
    expect((await fetch(new URL("/@vite/client", origin))).status).toBe(200);
    writeFileSync(path, original);
    await vi.waitFor(async () => {
      const response = await fetch(new URL("/src/routes/server-chain.jsx", origin));
      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain("body.server.js");
    }, { timeout: 10000 });
    expect((await fetch(new URL("/server-chain", origin))).status).toBe(200);
  } finally {
    send.mockRestore();
    writeFileSync(path, original);
  }
}, 30000);
