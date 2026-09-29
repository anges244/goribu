import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createTestHarness } from "wrangler";
import { expect, it } from "vitest";
import { goribu } from "goribu/vite";

const fixture = fileURLToPath(new URL("../../../fixtures/basic-app", import.meta.url));
const cli = fileURLToPath(new URL("../bin/goribu.js", import.meta.url));

it("starts, uploads and verifies public/private files through dev and the built Worker", async () => {
  const root = mkdtempSync(join(tmpdir(), "goribu-r2-uploads-"));
  let server, harness;
  try {
    cpSync(join(fixture, "src"), join(root, "src"), { recursive: true });
    cpSync(join(fixture, "package.json"), join(root, "package.json"));
    symlinkSync(join(fixture, "node_modules"), join(root, "node_modules"), "dir");
    writeFileSync(join(root, "vite.config.js"), 'import { goribu } from "goribu/vite"; export default { plugins: [goribu()] };');
    writeFileSync(join(root, "goribu.config.js"), 'import { defineConfig } from "goribu/server"; export default defineConfig({ name: "upload-transports", compatibilityDate: "2026-09-01", responseHeaders: () => ({ "x-worker": "ran" }), r2: { name: "fixture-media", domain: "media.example.com", private: { name: "fixture-files" } } });');
    mkdirSync(join(root, "src/routes/upload-save"));
    writeFileSync(join(root, "src/routes/upload-save/_middleware.js"), `export default function(req, res) {
      if (req.headers.get("x-user") !== "test-user") return res.status(403).json({ forbidden: true });
      req.user = "test-user";
      res.headers({ "x-middleware": "ran" });
    }`);
    writeFileSync(join(root, "src/routes/upload-save/index.js"), `
      const field = { accept: ["image/png"], maxBytes: 100, key: ({ req, ext }) => req.query.get("key") ?? req.user + "/" + crypto.randomUUID() + ext };
      export const uploads = { avatar: field, contract: { ...field, private: true }, localDirect: { ...field, private: true, direct: true } };
      export async function PATCH(req, res) {
        const body = await req.body();
        if (body !== await req.body()) throw new Error("body was not cached");
        return res.json(body);
      }
    `);
    writeFileSync(join(root, "src/routes/upload-page.jsx"), `import { Form } from "goribu";
      export default function Page() { return <Form method="patch" action="/upload-save"><button>Save</button></Form>; }`);
    // Test-only inspection stays in the fixture Worker, never in production source.
    writeFileSync(join(root, "src/routes/inspect-upload.js"), `export async function GET(req, res) {
      const bucket = req.query.has("private") ? req.r2.private : req.r2;
      const object = await bucket.get(req.query.get("key"));
      return res.json(object ? { size: object.size, metadata: object.httpMetadata, customMetadata: object.customMetadata, bytes: await object.text(), link: await bucket.signedUrl(object.key) } : null);
    }`);
    async function exercise(base, development) {
      const action = new URL("/upload-save", base);
      const startOptions = (field, authorized = true, size = 4) => ({ method: "POST", headers: { "content-type": "application/json", "x-goribu-upload": field, ...(authorized ? { "x-user": "test-user" } : {}) }, body: JSON.stringify({ name: "test.PNG", type: "image/png", size }) });
      const forbidden = await fetch(action, startOptions("avatar", false));
      expect(forbidden.status).toBe(403);
      expect(await forbidden.json()).toEqual({ forbidden: true });
      for (const field of ["avatar", "contract", ...(development ? ["localDirect"] : [])]) {
        const start = await fetch(action, startOptions(field));
        expect(start.status, await start.clone().text()).toBe(200);
        expect(start.headers.get("x-middleware")).toBe("ran");
        const { target, ref } = await start.json();
        expect(target).toEqual({ url: `/_goribu/r2/upload?ref=${ref}`, method: "PUT", headers: { "content-type": "image/png" } });
        const put = () => fetch(new URL(target.url, base), { method: target.method, headers: target.headers, body: "data" });
        // Two uploads with the same ref must not overwrite, even in a race.
        const transfers = await Promise.all([put(), put()]);
        expect(transfers.map((response) => response.status).sort(), await Promise.all(transfers.map((response) => response.text()))).toEqual([200, 409]);
        const submit = () => fetch(action, { method: "PATCH", headers: { "x-user": "test-user" }, body: new URLSearchParams({ [field]: ref, note: "kept" }) });
        const saved = await submit();
        expect(saved.status, await saved.clone().text()).toBe(200);
        const result = await saved.json();
        const uploaded = result[field];
        expect(result.note).toBe("kept");
        expect(uploaded).toMatchObject({ name: "test.PNG", type: "image/png", size: 4 });
        expect(uploaded.key).toMatch(/^test-user\/[a-f0-9-]+\.png$/);
        if (field === "avatar") expect(uploaded.url).toBe(`${development ? "/_goribu/r2/public" : "https://media.example.com"}/${uploaded.key}`);
        else expect(uploaded).not.toHaveProperty("url");
        expect(await (await submit()).json()).toEqual(result);
        const stored = await (await fetch(new URL(`/inspect-upload?key=${encodeURIComponent(uploaded.key)}${field === "avatar" ? "" : "&private"}`, base))).json();
        expect(stored.bytes).toBe("data");
        expect(stored.metadata.contentType).toBe("image/png");
        expect(stored.metadata.cacheControl).toBe(field === "avatar" ? "public, max-age=31536000, immutable" : undefined);
        expect(stored.customMetadata["goribu-upload"]).toMatch(/^[a-f0-9-]{36}$/);
        const downloaded = await fetch(stored.link);
        expect(downloaded.status).toBe(200);
        expect(await downloaded.text()).toBe("data");
        // A deterministic policy key can mint a new ref over an old avatar.
        // Neither skipping PUT nor receiving 409 establishes ownership of it,
        // even when the declared metadata happens to match the old object's.
        for (const attemptPut of [false, true]) {
          for (const size of [4, 3]) {
            const startAgain = await fetch(new URL(`/upload-save?key=${encodeURIComponent(uploaded.key)}`, base), startOptions(field, true, size));
            expect(startAgain.status).toBe(200);
            const next = await startAgain.json();
            if (attemptPut) {
              const conflict = await fetch(new URL(next.target.url, base), { method: "PUT", headers: next.target.headers, body: "x".repeat(size) });
              expect(conflict.status).toBe(409);
            }
            const submitted = await fetch(action, { method: "PATCH", headers: { "x-user": "test-user" }, body: new URLSearchParams({ [field]: next.ref }) });
            expect(submitted.status).toBe(200);
            expect(await submitted.json()).toEqual({});
            const preserved = await (await fetch(new URL(`/inspect-upload?key=${encodeURIComponent(uploaded.key)}${field === "avatar" ? "" : "&private"}`, base))).json();
            expect(preserved).toMatchObject({ bytes: "data", size: 4, metadata: stored.metadata, customMetadata: stored.customMetadata });
          }
        }
      }
      for (const path of ["/_goribu/r2/unknown", "/_goribu/r2/private/key", "/_goribu/r2/upload/"]) expect((await fetch(new URL(path, base), { redirect: "manual" })).status).toBe(404);
      expect((await fetch(new URL("/_goribu/r2/upload", base))).status).toBe(405);
    }
    server = await createServer({ root, configFile: false, logLevel: "silent", plugins: [goribu()], server: { host: "127.0.0.1", port: 0 } });
    await server.listen();
    await exercise(server.resolvedUrls.local[0], true);
    await server.close();
    server = undefined;
    const built = spawnSync(process.execPath, [cli, "build"], { cwd: root, encoding: "utf8", timeout: 100000, env: { ...process.env, NODE_ENV: "production" } });
    expect(built.error).toBeUndefined();
    expect(built.status, built.stdout + built.stderr).toBe(0);
    harness = createTestHarness({ workers: [{ configPath: join(root, ".goribu/dist/upload_transports/wrangler.json"), secrets: { GORIBU_SECRET: "test-only-upload-secret" } }] });
    const { url } = await harness.listen();
    const page = await fetch(new URL("/upload-page", url));
    expect(page.headers.get("x-worker")).toBeNull();
    expect(await page.text()).toBe(readFileSync(join(root, ".goribu/dist/client/upload-page.html"), "utf8"));
    await exercise(url, false);
  } finally {
    await server?.close();
    await harness?.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 150000);
