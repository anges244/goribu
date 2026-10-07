import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { goribu } from "../src/build/create-goribu-vite-plugin.js";

const fixture = fileURLToPath(new URL("../../../fixtures/basic-app", import.meta.url));
let root, server, origin;
let starts = 0;
const component = (source) => `import message from ${JSON.stringify(source)};
export default function Message() { return <h1>{message}</h1>; }`;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "goribu-missing-import-"));
  cpSync(join(fixture, "src"), join(root, "src"), { recursive: true });
  for (const name of ["package.json", "goribu.config.js"]) cpSync(join(fixture, name), join(root, name));
  symlinkSync(join(fixture, "node_modules"), join(root, "node_modules"), "dir");
  mkdirSync(join(root, "src/components"), { recursive: true });
  writeFileSync(join(root, "src/components/message.js"), 'export default "initial message";');
  writeFileSync(join(root, "src/components/Message.jsx"), component("./message.js"));
  writeFileSync(join(root, "src/routes/index.jsx"), 'import Message from "../components/Message.jsx"; export default function Page() { return <Message />; }');
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { allowJs: true, paths: { "@local/*": ["./src/components/*"] } },
  }));
  server = await createServer({
    root, configFile: false, logLevel: "silent",
    cacheDir: join(root, ".vite-cache"),
    resolve: { tsconfigPaths: true, alias: { "@": join(root, "src") } },
    plugins: [goribu(), { name: "observe-session", configureServer() { starts++; } }],
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = server.resolvedUrls.local[0];
}, 30000);

afterAll(async () => {
  await server?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

async function page() {
  const response = await fetch(origin, { signal: AbortSignal.timeout(5000) });
  return { status: response.status, text: await response.text() };
}

it("recovers missing relative and aliased imports when their files appear, without touching the importer or restarting", async () => {
  expect((await page()).text).toContain("initial message");
  const environments = server.environments;
  for (const [source, filename, message] of [
    ["./created-first", "created-first.js", "first recovery"],
    ["@/components/created-second", "created-second.js", "second recovery"],
  ]) {
    writeFileSync(join(root, "src/components/Message.jsx"), component(source));
    await vi.waitFor(async () => expect((await page()).status).toBe(500), { timeout: 5000 });
    writeFileSync(join(root, "src/components", filename), `export default ${JSON.stringify(message)};`);
    await vi.waitFor(async () => {
      const response = await page();
      expect(response.status, response.text).toBe(200);
      expect(response.text).toContain(message);
    }, { timeout: 5000 });
    // The browser graph can transform the same repaired import, too.
    expect((await fetch(new URL("/src/components/Message.jsx", origin))).status).toBe(200);
  }
  expect(starts).toBe(1);
  expect(server.environments).toBe(environments);
}, 20000);

it("recovers native tsconfig path imports when their files appear without touching the importer or restarting", async () => {
  const importer = join(root, "src/components/Message.jsx");
  const environments = server.environments;
  writeFileSync(importer, component("@local/message"));
  await vi.waitFor(async () => {
    const response = await page();
    expect(response.status).toBe(200);
    expect(response.text).toContain("initial message");
  }, { timeout: 5000 });
  writeFileSync(importer, component("@local/native-created"));
  await vi.waitFor(async () => {
    const response = await page();
    expect(response.status).toBe(500);
    expect(response.text).toContain("@local/native-created");
  }, { timeout: 5000 });
  writeFileSync(join(root, "src/components/native-created.js"), 'export default "native paths recovered";');
  await vi.waitFor(async () => {
    const response = await page();
    expect(response.status, response.text).toBe(200);
    expect(response.text).toContain("native paths recovered");
  }, { timeout: 5000 });
  expect((await fetch(new URL("/src/components/Message.jsx", origin))).status).toBe(200);
  expect(starts).toBe(1);
  expect(server.environments).toBe(environments);
}, 20000);

it("recovers batched missing dependencies and deletion followed by recreation", async () => {
  writeFileSync(join(root, "src/components/Message.jsx"), `
import left from "./left";
import right from "./right";
export default function Message() { return <h1>{left} {right}</h1>; }
`);
  await vi.waitFor(async () => expect((await page()).status).toBe(500), { timeout: 5000 });
  writeFileSync(join(root, "src/components/left.js"), 'export default "left";');
  writeFileSync(join(root, "src/components/right.js"), 'export default "right";');
  await vi.waitFor(async () => {
    const response = await page();
    expect(response.status).toBe(200);
    expect(response.text).toContain("left");
    expect(response.text).toContain("right");
  }, { timeout: 5000 });
  rmSync(join(root, "src/components/right.js"));
  await vi.waitFor(async () => expect((await page()).status).toBe(500), { timeout: 5000 });
  writeFileSync(join(root, "src/components/right.js"), 'export default "restored";');
  await vi.waitFor(async () => {
    const response = await page();
    expect(response.status).toBe(200);
    expect(response.text).toContain("restored");
  }, { timeout: 5000 });
  expect(starts).toBe(1);
}, 20000);
