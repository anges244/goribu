import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createTestHarness } from "wrangler";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createNavigationController } from "../src/browser/create-navigation-controller.js";

const fixture = fileURLToPath(new URL("../../../fixtures/basic-app", import.meta.url));
const cli = fileURLToPath(new URL("../bin/goribu.js", import.meta.url));
let root, clientDir, harness, origin, manifest;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "goribu-static-navigation-"));
  clientDir = join(root, "dist/client");
  cpSync(join(fixture, "src"), join(root, "src"), { recursive: true });
  cpSync(join(fixture, "package.json"), join(root, "package.json"));
  symlinkSync(join(fixture, "node_modules"), join(root, "node_modules"), "dir");
  writeFileSync(join(root, "vite.config.js"), 'import { goribu } from "goribu/vite"; export default { plugins: [goribu()] };');
  writeFileSync(join(root, "goribu.config.js"), `import { defineConfig } from "goribu/server";
export default defineConfig({ name: "static-navigation-test", compatibilityDate: "2026-08-31",
  responseHeaders: () => ({ "x-worker-executed": "yes" }) });`);
  writeFileSync(join(root, "src/routes/snapshot.jsx"), `
import { Link } from "goribu";
export const prerender = true;
export function GET(req, res) {
  return res.render({ token: crypto.randomUUID(), query: req.query.get("q"), text: "</script><script>bad()</script>" });
}
export function meta({ props, url }) { return { title: props.token, description: url.search || "build snapshot" }; }
export default function Snapshot({ token, text }) { return <main data-id="__GORIBU_PROPS__" data-route-id="__GORIBU_ROUTE__"><h1>{token}</h1><p>{text}</p><Link href="/">Home</Link></main>; }
`);
  writeFileSync(join(root, "src/routes/broken.jsx"), 'export default function Broken() { throw new Error("cannot prerender"); }');
  const result = spawnSync(process.execPath, [cli, "build"], {
    cwd: root, encoding: "utf8", timeout: 100000,
    env: { ...process.env, NODE_ENV: "production" },
  });
  expect(result.error, String(result.error)).toBeUndefined();
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  manifest = JSON.parse(readFileSync(join(clientDir, "_goribu/navigation.json"), "utf8"));
  harness = createTestHarness({ workers: [{ configPath: join(root, "dist/static_navigation_test/wrangler.json") }] });
  const { url } = await harness.listen();
  origin = new URL(url).origin;
}, 120000);

afterAll(async () => {
  await harness?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

it("serves the index and the exact HTML snapshot's props and metadata without executing the Worker", async () => {
  expect(Object.keys(manifest.routes).sort()).toEqual(["/", "/about", "/snapshot"]);
  const index = await fetch(`${origin}/_goribu/navigation.json`);
  expect(index.headers.get("x-worker-executed")).toBeNull();
  expect(index.headers.get("cache-control")).toContain("no-store");
  expect(await index.json()).toEqual(manifest);
  const response = await fetch(new URL(manifest.routes["/snapshot"].asset, origin));
  expect(response.status).toBe(200);
  expect(response.headers.get("x-worker-executed")).toBeNull();
  expect(response.headers.get("cache-control")).toContain("immutable");
  const payload = await response.json();
  const documentResponse = await fetch(`${origin}/snapshot?q=request`);
  expect(documentResponse.headers.get("x-worker-executed")).toBeNull();
  const dom = new JSDOM(await documentResponse.text());
  try {
    const props = JSON.parse(dom.window.document.getElementById("__GORIBU_PROPS__").textContent);
    expect(payload.props).toEqual(props);
    expect(payload.props.query).toBeNull();
    expect(payload.meta).toEqual({ title: props.token, description: "build snapshot" });
    expect(dom.window.document.querySelector("h1").textContent).toBe(props.token);
  } finally { dom.window.close(); }
  // A new Worker execution produces different data, proving the saved payload
  // came from the HTML's original execution rather than a second build request.
  const live = await harness.getWorker().fetch(`${origin}/_goribu/worker-nav?to=/snapshot`);
  expect(live.headers.get("x-goribu-build")).toBe(manifest.buildId);
  expect((await live.json()).props.token).not.toBe(payload.props.token);
});

it("routes client navigation and prefetch through real Static Assets while dynamic pages still execute the Worker", async () => {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: `${origin}/` });
  dom.window.scrollTo = vi.fn();
  const root = { render: vi.fn() };
  const requests = [];
  const controller = createNavigationController({
    root, browserWindow: dom.window, navigationBuildId: manifest.buildId,
    pageLoaders: Object.fromEntries(["index", "about", "snapshot", "greet"].map((name) => [
      `src/routes/${name}.jsx`, async () => ({ default: function Page() {} }),
    ])),
    fetch: async (...args) => {
      const response = await fetch(...args);
      requests.push({ path: new URL(args[0]).pathname, worker: response.headers.get("x-worker-executed") });
      return response;
    },
    afterRender: async () => {},
  });
  try {
    await controller.prefetch("/snapshot?q=client");
    await controller.navigate("/snapshot?q=client");
    expect(dom.window.document.title).toBeTruthy();
    expect(requests.every((request) => request.worker === null)).toBe(true);
    expect(requests.map((request) => request.path)).toEqual(["/_goribu/navigation.json", manifest.routes["/snapshot"].asset]);
    const count = requests.length;
    await controller.navigate("/snapshot?q=client");
    expect(requests).toHaveLength(count);
    expect(root.render).toHaveBeenCalledOnce();
    await controller.navigate("/greet?name=Static");
    expect(requests.at(-1)).toEqual({ path: "/_goribu/worker-nav", worker: "yes" });
    expect(dom.window.location.pathname).toBe("/greet");
    await controller.navigate("/about/");
    expect(requests.at(-1)).toEqual({ path: manifest.routes["/about"].asset, worker: null });
    expect(dom.window.location.pathname).toBe("/about");
  } finally { controller.dispose(); dom.window.close(); }
});
