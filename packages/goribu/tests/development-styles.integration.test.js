import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { goribu } from "goribu/vite";

const fixture = fileURLToPath(new URL("../../../fixtures/basic-app", import.meta.url));
let root;
let server;
let origin;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "goribu-dev-styles-"));
  cpSync(join(fixture, "src"), join(root, "src"), { recursive: true });
  for (const name of ["package.json", "goribu.config.js"]) cpSync(join(fixture, name), join(root, name));
  symlinkSync(join(fixture, "node_modules"), join(root, "node_modules"), "dir");
  const document = join(root, "src/setup/_document.jsx");
  writeFileSync(document, readFileSync(document, "utf8")
    .replace("{ ClientEntry }", "{ ClientEntry, Stylesheet }")
    .replace("<title>", "<Stylesheet /><title>"));
  writeFileSync(join(root, "src/setup/client-entry.js"), 'import "goribu/client";\nimport "../styles.css";\nimport "../ignored.css?inline";\n');
  writeFileSync(join(root, "src/styles.css"), '@import "./tokens.css";\nh1 { font-size: 36px; }\n');
  writeFileSync(join(root, "src/tokens.css"), 'body { color: rgb(10, 20, 30); }\n');
  writeFileSync(join(root, "src/ignored.css"), 'h1 { font-size: 99px; }\n');
  writeFileSync(join(root, "src/greeting.module.css"), '.heading { color: rgb(40, 50, 60); }\n');
  const greeting = join(root, "src/routes/greet.jsx");
  writeFileSync(greeting, 'import classes from "../greeting.module.css";\n' + readFileSync(greeting, "utf8").replace('<h1>', '<h1 className={classes.heading}>'));
  server = await createServer({
    root,
    cacheDir: join(root, ".vite-cache"),
    configFile: false,
    logLevel: "silent",
    plugins: [goribu()],
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  origin = server.resolvedUrls.local[0];
}, 30000);

afterAll(async () => {
  await server?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

it("styles cold full-page renders without executing any browser JavaScript", async () => {
  for (const path of ["/", "/greet?name=CSS"]) {
    // No runScripts option: stylesheet loading must suffice, without hydration.
    const dom = await JSDOM.fromURL(new URL(path, origin).href, { resources: "usable" });
    try {
      await new Promise((resolve) => dom.window.addEventListener("load", resolve, { once: true }));
      const heading = dom.window.document.querySelector("h1");
      expect(dom.window.getComputedStyle(heading).fontSize).toBe("36px");
      expect(dom.window.getComputedStyle(heading).color).toBe(path === "/" ? "rgb(10, 20, 30)" : "rgb(40, 50, 60)");
      expect(dom.window.document.querySelector("link[data-goribu-dev-styles]")).not.toBeNull();
    } finally {
      dom.window.close();
    }
  }
}, 30000);

// Removing the link at hydration discarded fonts it had loaded, so swap fonts
// flashed back to their fallback. Run the page manifest exactly as the dev server
// serves it, against a recording Vite client, to see when the link goes.
it("keeps the first-paint stylesheet until the first hot update", async () => {
  const served = await (await fetch(new URL("/@id/__x00__virtual:goribu/client-pages", origin))).text();
  const listeners = new Map();
  globalThis.goribuTestHot = {
    on: (event, listener) => listeners.set(event, [...(listeners.get(event) ?? []), listener]),
  };
  const viteClient = "data:text/javascript,export const createHotContext = () => globalThis.goribuTestHot;";
  expect(served).toContain('from "/@vite/client"');

  const dom = await JSDOM.fromURL(new URL("/", origin).href);
  const previousDocument = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    await import(`data:text/javascript,${encodeURIComponent(served.replace('"/@vite/client"', JSON.stringify(viteClient)))}`);
    expect(dom.window.document.querySelectorAll("link[data-goribu-dev-styles]")).toHaveLength(1);

    for (const listener of listeners.get("vite:beforeUpdate") ?? []) listener({ type: "update", updates: [] });
    expect(dom.window.document.querySelectorAll("link[data-goribu-dev-styles]")).toHaveLength(0);
  } finally {
    globalThis.document = previousDocument;
    delete globalThis.goribuTestHot;
    dom.window.close();
  }
}, 30000);

it("uses the current Vite graph after a stylesheet import changes and rejects unknown routes", async () => {
  const url = new URL("/_goribu/dev-styles.css?route=src%2Froutes%2Findex.jsx", origin);
  expect(await (await fetch(url)).text()).toContain("/src/styles.css?direct");
  writeFileSync(join(root, "src/replacement.css"), "h1 { font-size: 42px; }\n");
  writeFileSync(join(root, "src/setup/client-entry.js"), 'import "goribu/client";\nimport "../replacement.css";\n');
  await vi.waitFor(async () => {
    const response = await fetch(url);
    expect(response.status).toBe(200);
    const css = await response.text();
    expect(css).toContain("/src/replacement.css?direct");
    expect(css).not.toContain("/src/styles.css");
  }, { timeout: 5000 });
  url.searchParams.set("route", "../../private.js");
  expect((await fetch(url)).status).toBe(404);
}, 10000);

it("refreshes nested imports and recovers deleted dependencies after the discovery cache is warm", async () => {
  const url = new URL("/_goribu/dev-styles.css?route=src%2Froutes%2Findex.jsx", origin);
  const entry = join(root, "src/setup/client-entry.js");
  const nested = join(root, "src/nested-styles.js");
  writeFileSync(nested, 'export * from "./leaf-styles.js";\n');
  writeFileSync(join(root, "src/leaf-styles.js"), 'import "./styles.css";\n');
  writeFileSync(entry, 'import "goribu/client";\nimport "../nested-styles.js";\n');
  async function expectStyles(expected, absent) {
    await vi.waitFor(async () => {
      const response = await fetch(url);
      expect(response.status).toBe(200);
      const css = await response.text();
      expect(css).toContain(expected);
      if (absent) expect(css).not.toContain(absent);
    }, { timeout: 10000 });
  }
  await expectStyles("/src/styles.css?");
  const warm = await Promise.all(Array.from({ length: 10 }, async () => (await fetch(url)).text()));
  expect(new Set(warm).size).toBe(1);
  writeFileSync(join(root, "src/leaf-styles.js"), 'import "./replacement.css";\n');
  await expectStyles("/src/replacement.css?", "/src/styles.css?");
  rmSync(join(root, "src/leaf-styles.js"));
  await vi.waitFor(async () => expect((await fetch(url)).status).toBe(500), { timeout: 10000 });
  writeFileSync(join(root, "src/leaf-styles.js"), 'import "./styles.css";\n');
  await expectStyles("/src/styles.css?", "/src/replacement.css?");
}, 30000);
