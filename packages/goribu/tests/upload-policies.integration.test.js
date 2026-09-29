import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestHarness } from "wrangler";
import { expect, it } from "vitest";
import { readR2Uploads } from "../src/build/read-r2-uploads.js";

const fixture = fileURLToPath(new URL("../../../fixtures/basic-app", import.meta.url));
const cli = fileURLToPath(new URL("../bin/goribu.js", import.meta.url));
const marker = "UPLOAD_KEY_FUNCTION_MUST_STAY_SERVER_SIDE_4bd98e";
const closureMarker = "UPLOAD_SERVER_DEPENDENCY_MUST_STAY_SERVER_SIDE_f1e260";
const hints = { avatar: { accept: ["image/png"], maxBytes: 5_000_000 } };

function build(root) {
  return spawnSync(process.execPath, [cli, "build"], {
    cwd: root, encoding: "utf8", timeout: 100000,
    env: { ...process.env, NODE_ENV: "production" },
  });
}

it("isolates policies, emits safe hints, and routes a static page's upload POST to its Worker action", async () => {
  const root = mkdtempSync(join(tmpdir(), "goribu-upload-policies-"));
  let harness;
  try {
    cpSync(join(fixture, "src"), join(root, "src"), { recursive: true });
    cpSync(join(fixture, "package.json"), join(root, "package.json"));
    symlinkSync(join(fixture, "node_modules"), join(root, "node_modules"), "dir");
    writeFileSync(join(root, "vite.config.js"), 'import { goribu } from "goribu/vite"; export default { plugins: [goribu()], environments: { client: { build: { sourcemap: true } } } };');
    writeFileSync(join(root, "goribu.config.js"), `import { defineConfig } from "goribu/server"; export default defineConfig({ name: "upload-policies", compatibilityDate: "2026-09-01", responseHeaders: () => ({ "x-upload-worker": "ran" }), r2: { name: "fixture-media", domain: "media.example.com", private: { name: "fixture-files" } } });`);
    writeFileSync(join(root, "src/upload-key.server.js"), `export function serverKey() { return ${JSON.stringify(closureMarker)}; }`);
    mkdirSync(join(root, "src/routes/upload-action"));
    writeFileSync(join(root, "src/routes/upload-action/_middleware.js"), 'export default function (req, res) { res.headers({ "x-upload-middleware": "ran" }); }');
    writeFileSync(join(root, "src/routes/upload-action/index.jsx"), `
import { serverKey } from "../../upload-key.server.js";
export const uploads = {
  avatar: { accept: ["image/png"], maxBytes: 5_000_000, private: true, direct: true,
    key: ({ req }) => {
      if (req.env.__GORIBU_PRERENDER) throw new Error(${JSON.stringify(marker)} + serverKey());
      return "avatars/" + crypto.randomUUID();
    } }
};
export function POST(req, res) { if (req.query.has("render")) return res.render({}); return res.json({ field: req.headers.get("x-goribu-upload"), reached: "Worker action" }); }
export default function Page() { return <h1>Upload action page</h1>; }
`);
    writeFileSync(join(root, "src/routes/upload-page.jsx"), `
import { Form } from "goribu";
export default function Page() { return <Form method="post" action="/upload-action"><button type="submit">Save</button></Form>; }
`);
    const built = build(root);
    expect(built.error).toBeUndefined();
    expect(built.status, built.stdout + built.stderr).toBe(0);
    const client = join(root, ".goribu/dist/client");
    expect(existsSync(join(client, "upload-page.html")), built.stdout + built.stderr).toBe(true);
    const worker = join(root, ".goribu/dist/upload_policies");
    const workerSource = readFileSync(join(worker, "index.js"), "utf8");
    expect(workerSource).toContain(marker);
    expect(workerSource).toContain(closureMarker);
    const metadata = JSON.parse(readFileSync(join(worker, "r2-uploads.json"), "utf8"));
    expect(Number.isFinite(Date.parse(metadata.builtAt))).toBe(true);
    expect(metadata).toEqual({ version: 1, builtAt: expect.any(String), routes: [{ id: "src/routes/upload-action/index.jsx", pattern: "/upload-action", fields: {
      avatar: { ...hints.avatar, private: true, direct: true },
    } }] });
    expect(readR2Uploads({ projectRoot: root, required: true, appConfig: {
      name: "upload-policies", r2: { name: "fixture-media", domain: "media.example.com", private: { name: "fixture-files" } },
    } })).toEqual({ builtAt: metadata.builtAt, routes: metadata.routes });
    expect(existsSync(join(client, "upload-action.html"))).toBe(false);
    // Inspect every client artifact, including HTML, navigation data and chunks.
    let sourceMaps = 0;
    for (const file of readdirSync(client, { recursive: true, withFileTypes: true })) {
      if (!file.isFile()) continue;
      const text = readFileSync(join(file.parentPath, file.name), "utf8");
      if (file.name.endsWith(".map")) sourceMaps++;
      expect(text).not.toContain(marker);
      expect(text).not.toContain(closureMarker);
    }
    expect(sourceMaps).toBeGreaterThan(0);
    harness = createTestHarness({ workers: [{ configPath: join(worker, "wrangler.json"), secrets: {
      GORIBU_SECRET: "test-only-upload-secret", R2_ACCESS_KEY_ID: "test-only-access-key",
      R2_SECRET_ACCESS_KEY: "test-only-secret-key", GORIBU_R2_ACCOUNT_ID: "a".repeat(32),
    } }] });
    const { url } = await harness.listen();
    const staticPage = await fetch(new URL("/upload-page", url));
    expect(staticPage.status).toBe(200);
    expect(staticPage.headers.get("x-upload-worker")).toBeNull();
    const html = await staticPage.text();
    expect(html).toBe(readFileSync(join(client, "upload-page.html"), "utf8"));
    expect(html).toContain('action="/upload-action"');
    expect(html).not.toContain('"uploads"');
    // Use the public HTTP listener: getWorker().fetch() bypasses Static Assets
    // and cannot prove that action requests survive production asset routing.
    // The framework mints the target after middleware instead of invoking POST.
    const started = await fetch(new URL("/upload-action", url), {
      method: "POST", headers: { "x-goribu-upload": "avatar", "content-type": "application/json" },
      body: JSON.stringify({ name: "avatar.png", type: "image/png", size: 100 }),
    });
    expect(started.status).toBe(200);
    expect(started.headers.get("x-upload-worker")).toBe("ran");
    expect(started.headers.get("x-upload-middleware")).toBe("ran");
    const startResult = await started.json();
    expect(Object.keys(startResult).sort()).toEqual(["ref", "target"]);
    expect(startResult.ref).toEqual(expect.any(String));
    expect(new URL(startResult.target.url).hostname).toBe(`${"a".repeat(32)}.r2.cloudflarestorage.com`);
    expect(startResult.target.method).toBe("PUT");
    const action = await fetch(new URL("/upload-action", url));
    const actionHtml = await action.text();
    const identity = JSON.parse(actionHtml.match(/<script id="__GORIBU_ROUTE__" type="application\/json"[^>]*>([^<]*)<\/script>/)[1]);
    expect(identity.uploads).toEqual(hints);
    const navigation = await fetch(new URL("/_goribu/worker-nav?to=/upload-action", url));
    expect(navigation.status).toBe(200);
    expect((await navigation.json()).uploads).toEqual(hints);
    const formRender = await fetch(new URL("/upload-action?render", url), {
      method: "POST", headers: { accept: "application/vnd.goribu.form+json", referer: new URL("/upload-action", url).href },
    });
    expect(formRender.status).toBe(200);
    expect((await formRender.json()).uploads).toEqual(hints);
    expect((await fetch(new URL("/_goribu/build/uploads", url))).status).toBe(404);
    expect((await fetch(new URL("/_goribu/build/uploads?__GORIBU_PRERENDER=true", url), { headers: { "__GORIBU_PRERENDER": "true" } })).status).toBe(404);
    await harness.close();
    harness = undefined;

    // An action-only app must still validate policies: there is no static page
    // whose prerender would happen to initialize the Worker.
    rmSync(join(root, "src/routes"), { recursive: true });
    mkdirSync(join(root, "src/routes"));
    writeFileSync(join(root, "src/routes/too-large.js"), 'export const uploads = { video: { accept: ["video/mp4"], maxBytes: 100_000_001 } }; export function POST(req, res) { if (req.query.has("render")) return res.render({}); return res.json({}); }');
    const rejected = build(root);
    expect(rejected.error).toBeUndefined();
    expect(rejected.status).not.toBe(0);
    expect(rejected.stdout + rejected.stderr).toContain('Route "src/routes/too-large.js" uploads.video');
    expect(rejected.stdout + rejected.stderr).toContain("Add direct: true");
    // Wildcard re-exports cannot be treated as definite policy absence, even
    // when R2 itself is not configured.
    writeFileSync(join(root, "goribu.config.js"), 'import { defineConfig } from "goribu/server"; export default defineConfig({ name: "upload-policies", compatibilityDate: "2026-09-01" });');
    writeFileSync(join(root, "src/policy.js"), 'export const uploads = { avatar: { accept: ["image/png"], maxBytes: 100 } };');
    writeFileSync(join(root, "src/routes/too-large.js"), 'export * from "../policy.js"; export function POST(req, res) { return res.json({}); }');
    const missingConfig = build(root);
    expect(missingConfig.error).toBeUndefined();
    expect(missingConfig.status).not.toBe(0);
    expect(missingConfig.stdout + missingConfig.stderr).toContain("Configure r2 in goribu.config.js");
  } finally {
    await harness?.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 150000);
