import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createTestHarness } from "wrangler";
import { expect, it } from "vitest";
import { goribu } from "goribu/vite";
import { signToken, DOWNLOAD_PURPOSE, UPLOAD_PURPOSE } from "../src/r2/token.js";

const fixture = fileURLToPath(new URL("../../../fixtures/basic-app", import.meta.url));
const cli = fileURLToPath(new URL("../bin/goribu.js", import.meta.url));

async function fetchFile(url, options) {
  const response = await fetch(url, options);
  expect(response.headers.get("content-security-policy")).toBe("sandbox");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  return response;
}

it.each([
  { name: "r2-binding-default", r2: { name: "fixture-files" } },
  { name: "r2-binding-eu", r2: { name: "fixture-media", domain: "media.example.com", private: { name: "fixture-private" }, jurisdiction: "eu" } },
])("uses $name bindings in development and the built Worker", async ({ name, r2 }) => {
  const root = mkdtempSync(join(tmpdir(), "goribu-r2-bindings-"));
  let server;
  let harness;
  try {
    cpSync(join(fixture, "src"), join(root, "src"), { recursive: true });
    cpSync(join(fixture, "package.json"), join(root, "package.json"));
    symlinkSync(join(fixture, "node_modules"), join(root, "node_modules"), "dir");
    writeFileSync(join(root, "vite.config.js"), 'import { goribu } from "goribu/vite"; export default { plugins: [goribu()] };');
    writeFileSync(join(root, "goribu.config.js"),
      `import { defineConfig } from "goribu/server"; export default defineConfig({ ...${JSON.stringify({ name, compatibilityDate: "2026-09-01", r2 })},
        responseHeaders: () => ({ "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'" }) });`);
    const key = "nested/é a%?#/";
    const secret = "test-only-r2-download-secret";
    const html = '<!doctype html><script>document.body.dataset.uploadExecuted = "yes"</script>';
    writeFileSync(join(root, ".dev.vars"), `GORIBU_SECRET=${secret}\n`);
    writeFileSync(join(root, "src/routes/r2-download.js"), `
export async function GET(req, res) {
  const bucket = req.query.has("private") ? req.r2.private : req.r2;
  return res.json({ url: await bucket.signedUrl(req.query.get("key") ?? ${JSON.stringify(key)}, req.query.has("inline") ? {} : { download: "résumé.txt" }) });
}
`);
    writeFileSync(join(root, "src/routes/r2-binding.js"), `
export async function PUT(req, res) {
  await req.r2.put(${JSON.stringify(key)}, new File(["default bucket"], "example.txt", { type: "text/plain" }));
  await req.r2.put("unsafe.html", new Blob([${JSON.stringify(html)}], { type: "text/html" }));
  ${r2.private ? 'await req.r2.private.put("proof", "private bucket");' : ''}
  return res.json({ stored: true });
}
export async function GET(req, res) {
  const primary = await req.r2.get(${JSON.stringify(key)});
  const secondary = ${r2.private ? 'await req.r2.private.get("proof")' : 'null'};
  return res.json({ primary: primary ? await primary.text() : null,
    secondary: secondary ? await secondary.text() : null,
    contentType: primary?.httpMetadata.contentType,
    url: ${r2.domain ? `req.r2.url(${JSON.stringify(key)})` : 'null'} });
}
`);
    if (r2.domain) writeFileSync(join(root, "src/routes/r2-static.jsx"), `
export const prerender = true;
export function GET(req, res) { return res.render({ url: req.r2.url("static/a b.png") }); }
export default function Page({ url }) { return <a href={url}>Static R2 URL</a>; }
`);
    const encodedKey = key.split("/").map(encodeURIComponent).join("/");
    const expected = { primary: "default bucket", secondary: r2.private ? "private bucket" : null,
      contentType: "text/plain", url: r2.domain ? `/_goribu/r2/public/${encodedKey}` : null };
    async function startDev() {
      server = await createServer({ root, configFile: false, logLevel: "silent", plugins: [goribu()], server: { host: "127.0.0.1", port: 0 } });
      await server.listen();
      return new URL("/r2-binding", server.resolvedUrls.local[0]);
    }
    const devUrl = await startDev();
    const stored = await fetch(devUrl, { method: "PUT" });
    expect(stored.status, await stored.text()).toBe(200);
    expect(await (await fetch(devUrl)).json()).toEqual(expected);
    async function checkSignedDownloads(base) {
      const htmlLink = await (await fetch(new URL("/r2-download?key=unsafe.html&inline", base))).json();
      const htmlResponse = await fetchFile(htmlLink.url);
      expect(htmlResponse.status).toBe(200);
      expect(htmlResponse.headers.get("content-type")).toBe("text/html");
      expect(htmlResponse.headers.get("content-disposition")).toBeNull();
      expect(await htmlResponse.text()).toBe(html);
      const linkResponse = await fetch(new URL("/r2-download", base), { headers: { "x-goribu-prerender": "true" } });
      expect(linkResponse.status, await linkResponse.clone().text()).toBe(200);
      const { url: signedUrl } = await linkResponse.json();
      expect(new URL(signedUrl).origin).toBe(new URL(base).origin);
      expect(new URL(signedUrl).pathname).toBe("/_goribu/r2/file");
      const downloaded = await fetchFile(signedUrl);
      expect(downloaded.status).toBe(200);
      expect(await downloaded.text()).toBe("default bucket");
      expect(downloaded.headers.get("content-type")).toBe("text/plain");
      expect(downloaded.headers.get("content-disposition")).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9.txt");
      expect(downloaded.headers.get("cache-control")).toBe("private, max-age=0");
      const etag = downloaded.headers.get("etag");
      expect((await fetchFile(signedUrl, { headers: { "if-none-match": etag } })).status).toBe(304);
      expect((await fetchFile(signedUrl, { headers: { "if-match": '"not-the-etag"' } })).status).toBe(412);
      const head = await fetchFile(signedUrl, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
      for (const [range, body, contentRange] of [["bytes=1-3", "efa", "bytes 1-3/14"], ["bytes=-6", "bucket", "bytes 8-13/14"]]) {
        const partial = await fetchFile(signedUrl, { headers: { range } });
        expect(partial.status).toBe(206);
        expect(await partial.text()).toBe(body);
        expect(partial.headers.get("content-range")).toBe(contentRange);
        expect(partial.headers.get("content-length")).toBe(String(body.length));
      }
      const unsatisfiable = await fetchFile(signedUrl, { headers: { range: "bytes=999-" } });
      expect(unsatisfiable.status).toBe(416);
      expect(unsatisfiable.headers.get("content-range")).toBe("bytes */14");
      expect((await fetchFile(signedUrl, { method: "PUT", body: "no write" })).status).toBe(405);
      const missing = await (await fetch(new URL("/r2-download?key=missing", base))).json();
      expect((await fetchFile(missing.url)).status).toBe(404);
      const payload = { bucket: "default", key, exp: Math.floor(Date.now() / 1000) + 600 };
      for (const token of [
        new URL(signedUrl).searchParams.get("t") + "tampered",
        await signToken({ ...payload, exp: 1 }, secret, DOWNLOAD_PURPOSE),
        await signToken(payload, secret, UPLOAD_PURPOSE),
        await signToken({ ...payload, bucket: "R2_PRIVATE" }, secret, DOWNLOAD_PURPOSE),
      ]) {
        const url = new URL("/_goribu/r2/file", base);
        url.searchParams.set("t", token);
        expect((await fetchFile(url)).status).toBe(403);
      }
      if (r2.private) {
        const privateLink = await (await fetch(new URL("/r2-download?private&key=proof", base))).json();
        expect(await (await fetchFile(privateLink.url)).text()).toBe("private bucket");
      }
    }
    await checkSignedDownloads(devUrl);
    const publicUrl = new URL(`/_goribu/r2/public/${encodedKey}`, devUrl);
    const file = await fetchFile(publicUrl, { redirect: "manual" });
    expect(file.status).toBe(r2.domain ? 200 : 404);
    if (r2.domain) {
      const htmlResponse = await fetchFile(new URL("/_goribu/r2/public/unsafe.html", devUrl));
      expect(htmlResponse.status).toBe(200);
      expect(htmlResponse.headers.get("content-type")).toBe("text/html");
      expect(await htmlResponse.text()).toBe(html);
      expect(await file.text()).toBe("default bucket");
      expect(file.headers.get("content-type")).toBe("text/plain");
      expect(file.headers.get("cache-control")).toBe("no-cache");
      const etag = file.headers.get("etag");
      expect(etag).toMatch(/^".+"$/);
      const revalidated = await fetchFile(publicUrl, { headers: { "if-none-match": etag } });
      expect(revalidated.status).toBe(304);
      expect(await revalidated.text()).toBe("");
      const head = await fetchFile(publicUrl, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(head.headers.get("content-length")).toBe(String("default bucket".length));
      expect(await head.text()).toBe("");
      expect((await fetchFile(new URL("/_goribu/r2/public/missing", devUrl))).status).toBe(404);
      expect((await fetchFile(new URL("/_goribu/r2/public/proof", devUrl))).status).toBe(404);
      expect((await fetch(new URL("/_goribu/r2/private/proof", devUrl))).status).toBe(404);
    }
    await server.close();
    const restartedUrl = await startDev();
    expect(await (await fetch(restartedUrl)).json()).toEqual(expected);
    await server.close();
    server = undefined;

    const built = spawnSync(process.execPath, [cli, "build"], {
      cwd: root, encoding: "utf8", timeout: 100000,
      env: { ...process.env, NODE_ENV: "production" },
    });
    expect(built.error, String(built.error)).toBeUndefined();
    expect(built.status, `${built.stdout}\n${built.stderr}`).toBe(0);
    const configPath = join(root, ".goribu/dist", name.replaceAll("-", "_"), "wrangler.json");
    const builtConfig = JSON.parse(readFileSync(configPath, "utf8"));
    for (const file of readdirSync(dirname(configPath), { recursive: true }).filter((file) => file.endsWith(".js"))) {
      expect(readFileSync(join(dirname(configPath), file), "utf8"), file).not.toContain("Malformed R2 public-file key");
    }
    if (r2.domain) {
      const staticPage = readFileSync(join(root, ".goribu/dist/client/r2-static.html"), "utf8");
      expect(staticPage).toContain('href="https://media.example.com/static/a%20b.png"');
    }
    const location = r2.jurisdiction ? { jurisdiction: "eu" } : {};
    expect(builtConfig.r2_buckets).toEqual([
      { binding: "R2", bucket_name: r2.name, ...location },
      ...(r2.private ? [{ binding: "R2_PRIVATE", bucket_name: r2.private.name, ...location }] : []),
    ]);
    // The production artifact is executed locally; no bucket is provisioned.
    harness = createTestHarness({ workers: [{ configPath, secrets: { GORIBU_SECRET: secret } }] });
    const { url } = await harness.listen();
    const builtUrl = new URL("/r2-binding", url);
    const written = await fetch(builtUrl, { method: "PUT" });
    expect(written.status, await written.text()).toBe(200);
    expect(await (await fetch(builtUrl)).json()).toEqual({ ...expected, url: r2.domain ? `https://${r2.domain}/${encodedKey}` : null });
    await checkSignedDownloads(url);
    expect((await fetch(new URL(`/_goribu/r2/public/${encodedKey}`, url))).status).toBe(404);
    const page = await fetch(new URL("/", url));
    expect(page.status).toBe(200);
    expect(await page.text()).toBe(readFileSync(join(root, ".goribu/dist/client/index.html"), "utf8"));
    await harness.close();
    harness = undefined;
    if (r2.domain) {
      writeFileSync(join(root, "src/routes/r2-expiring.jsx"), `
export const prerender = true;
export async function GET(req, res) { return res.render({ url: await req.r2.signedUrl("key") }); }
export default function Page({ url }) { return <a href={url}>Private file</a>; }
`);
      const rejected = spawnSync(process.execPath, [cli, "build"], { cwd: root, encoding: "utf8", timeout: 100000, env: { ...process.env, NODE_ENV: "production" } });
      expect(rejected.error).toBeUndefined();
      expect(rejected.status).not.toBe(0);
      expect(rejected.stdout + rejected.stderr).toContain(
        'sets `export const prerender = true`, but the Worker called req.r2.signedUrl(), whose link would expire inside static HTML when it was rendered at build time.',
      );
      expect(rejected.stdout + rejected.stderr).toContain("remove the prerender export to serve it on the Worker");
    }
  } finally {
    await server?.close();
    await harness?.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 150000);
