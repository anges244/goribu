import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestHarness } from "wrangler";
import { expect, it } from "vitest";
import { generateManifest } from "../src/routing/generate-manifest.js";
import { planWorkerRouting } from "../src/build/plan-worker-routing.js";

it("routes the generated plan through Cloudflare's real asset front door", async () => {
  const root = mkdtempSync(join(tmpdir(), "goribu-worker-routing-"));
  let harness;
  function write(path, contents) {
    const file = join(root, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, contents);
  }
  try {
    const routes = {
      "index.jsx": "export default function Page() {}",
      "products/about.jsx": "export default function Page() {}",
      "products/[id].js": "export function GET() {}",
      "subscribe.js": "export function POST() {}",
      "oauth/callback.js": "export function GET() {}",
      "@user.js": "export function GET() {}",
      "a+b.js": "export function GET() {}",
      "x,y.js": "export function GET() {}",
      "k=v.js": "export function GET() {}",
      "a:b.js": "export function GET() {}",
    };
    for (const [path, source] of Object.entries(routes)) write(`src/routes/${path}`, source);
    const assets = {
      "index.html": "STATIC_HOME", "products/about.html": "STATIC_ABOUT",
      "404.html": "STATIC_404", "favicon.ico": "STATIC_ICON",
      "icon@2x.png": "STATIC_RETINA_ICON",
      "products/icon@2x.png": "STATIC_PRODUCT_ICON",
      "_goribu/assets/client-abc.js": "STATIC_SCRIPT",
      "_goribu/navigation.json": "STATIC_NAVIGATION",
    };
    for (const [path, source] of Object.entries(assets)) write(`public/${path}`, source);
    write("worker.js", `export default { fetch(request) {
      return new Response("WORKER", { headers: { "x-routing-worker": "yes" } });
    } };`);

    // Exercise both selective prefixes and the broad root-parameter case. The
    // second case must still leave concrete static pages and public files on the
    // asset layer using default asset-first routing.
    for (const broad of [false, true]) {
      if (broad) write("src/routes/[slug].js", "export function GET() {}");
      const manifest = generateManifest({ projectRoot: root, routesDir: join(root, "src/routes") });
      const staticRouteIds = new Set(manifest.filter((route) => route.hasDefaultExport).map((route) => route.id));
      const { patterns, notFoundHandling } = planWorkerRouting({ manifest, staticRouteIds, assetPaths: Object.keys(assets), r2: true });
      write("wrangler.json", JSON.stringify({
        name: "goribu-routing-test", main: "worker.js", compatibility_date: "2026-08-28",
        assets: { directory: "public", binding: "ASSETS", html_handling: "drop-trailing-slash",
          not_found_handling: notFoundHandling, ...(patterns === null ? {} : { run_worker_first: patterns }) },
      }));
      harness = createTestHarness({ workers: [{ configPath: join(root, "wrangler.json") }] });
      const { url } = await harness.listen();

      for (const headers of [{}, { "Sec-Fetch-Mode": "navigate" }]) {
        for (const [path, body] of [
          ["/", "STATIC_HOME"], ["/products/about", "STATIC_ABOUT"],
          ["/products/about/", "STATIC_ABOUT"], ["/products/about.html", "STATIC_ABOUT"],
          ["/favicon.ico", "STATIC_ICON"], ["/_goribu/assets/client-abc.js", "STATIC_SCRIPT"],
          ["/icon@2x.png", "STATIC_RETINA_ICON"],
          ["/products/icon@2x.png", "STATIC_PRODUCT_ICON"],
          ["/products/icon%402x.png", "STATIC_PRODUCT_ICON"],
          ["/_goribu/navigation.json", "STATIC_NAVIGATION"],
        ]) {
          const response = await fetch(new URL(path, url), { headers });
          expect(response.status, path).toBe(200);
          expect(response.headers.get("x-routing-worker"), `${path} -> ${response.url}`).toBeNull();
          expect(await response.text(), path).toBe(body);
        }
        for (const [path, method] of [
          ["/products/123", "GET"], ["/products/123/deep.php", "GET"],
          ["/subscribe", "POST"], ["/subscribe/", "POST"], ["/oauth/callback", "GET"],
          ["/@user", "GET"], ["/a+b", "GET"], ["/x,y", "GET"], ["/k=v", "GET"], ["/a:b", "GET"],
          ["/%40user", "GET"],
          ["/_goribu/worker-nav", "GET"], ["/_goribu/r2/upload", "PUT"], ["/_goribu/r2/file", "GET"],
        ]) {
          const response = await fetch(new URL(path, url), { method, headers });
          expect(response.headers.get("x-routing-worker"), `${method} ${path}`).toBe("yes");
          await response.text();
        }
        const missing = await fetch(new URL("/wp-admin.php", url), { headers });
        expect(missing.status).toBe(broad ? 200 : 404);
        expect(await missing.text()).toBe(broad ? "WORKER" : "STATIC_404");
        if (!broad) {
          for (const path of ["/subscribe/wp-login.php", "/oauth/callback/.env"]) {
            const response = await fetch(new URL(path, url), { headers, redirect: "manual" });
            expect(response.status, path).toBe(404);
            expect(response.headers.get("x-routing-worker"), path).toBeNull();
            expect(await response.text(), path).toBe("STATIC_404");
          }
          // Repeated slashes are owned by the asset layer. Cloudflare may
          // canonicalize them before a subsequent request reaches a real route.
          const repeated = await fetch(new URL("/subscribe//", url), { headers, redirect: "manual" });
          expect(repeated.status).toBe(307);
          expect(repeated.headers.get("location")).toBe("/subscribe/");
          expect(repeated.headers.get("x-routing-worker")).toBeNull();
          await repeated.text();
        }
      }
      if (!broad) {
        const head = await fetch(new URL("/unknown", url), { method: "HEAD" });
        expect(head.status).toBe(404);
        expect(await head.text()).toBe("");
        const post = await fetch(new URL("/unknown", url), { method: "POST" });
        expect(post.status).toBe(405);
        expect(post.headers.get("x-routing-worker")).toBeNull();
        await post.text();
      }
      await harness.close();
      harness = undefined;
    }
  } finally {
    await harness?.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
