import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { createTestHarness } from "wrangler";
import { afterAll, beforeAll, expect, it } from "vitest";

const fixture = fileURLToPath(new URL("../../../fixtures/basic-app", import.meta.url));
const cli = fileURLToPath(new URL("../bin/goribu.js", import.meta.url));
let root;
let clientDir;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "goribu-production-styles-"));
  clientDir = join(root, ".goribu/dist/client");
  cpSync(join(fixture, "src"), join(root, "src"), { recursive: true });
  for (const name of ["package.json", "goribu.config.js"]) cpSync(join(fixture, name), join(root, name));
  symlinkSync(join(fixture, "node_modules"), join(root, "node_modules"), "dir");
  writeFileSync(join(root, "vite.config.js"),
    'import { goribu } from "goribu/vite";\nexport default { plugins: [goribu()], build: { assetsInlineLimit: 0 } };\n');

  const document = join(root, "src/setup/_document.jsx");
  writeFileSync(document, readFileSync(document, "utf8")
    .replace("{ ClientEntry }", "{ ClientEntry, Stylesheet }")
    .replace("<title>", "<Stylesheet /><title>"));
  writeFileSync(join(root, "src/setup/client-entry.js"), 'import "goribu/client";\nimport "../styles.css";\n');
  writeFileSync(join(root, "src/styles.css"), 'body { --shared-style: global; }\n');
  writeFileSync(join(root, "src/home.css"), '@import "./palette.css";\nh1 { --page-style: home; background-image: url("./tile.svg"); }\n');
  writeFileSync(join(root, "src/palette.css"), 'body { --palette: home; }\n');
  writeFileSync(join(root, "src/tile.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg>');
  writeFileSync(join(root, "src/greeting.module.css"), '.heading { --page-style: greeting; }\n');
  const home = join(root, "src/routes/index.jsx");
  writeFileSync(home, 'import "../home.css";\n' + readFileSync(home, "utf8"));
  const greeting = join(root, "src/routes/greet.jsx");
  writeFileSync(greeting, 'import classes from "../greeting.module.css";\n' + readFileSync(greeting, "utf8").replace('<h1>', '<h1 className={classes.heading}>'));

  const result = spawnSync(process.execPath, [cli, "build"], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production" },
    encoding: "utf8",
    timeout: 100000,
  });
  expect(result.error, String(result.error)).toBeUndefined();
  expect(result.status, `${result.stdout ?? ""}\n${result.stderr ?? ""}`).toBe(0);
}, 120000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

it("keeps build paths out of emitted CSS filenames and public client output", () => {
  const assets = readdirSync(join(clientDir, "_goribu/assets"));
  const styles = assets.filter((file) => file.endsWith(".css"));
  expect(styles.length).toBeGreaterThanOrEqual(3);
  const paths = [root, encodeURIComponent(root), encodeURIComponent(root).replaceAll("%", "_")];
  for (const path of paths) expect(assets.join("\n")).not.toContain(path);
  for (const file of styles) expect(file).toMatch(/^style-[A-Za-z0-9_-]{8}\.css$/);

  for (const file of readdirSync(clientDir, { recursive: true }).filter((file) => /\.(?:html|js|css)$/.test(file))) {
    const source = readFileSync(join(clientDir, file), "utf8");
    for (const path of paths) {
      expect(file).not.toContain(path);
      expect(source, file).not.toContain(path);
    }
  }
});

it("serves static and Worker pages with their own CSS, shared CSS, and working asset URLs", async () => {
  const harness = createTestHarness({ workers: [{ configPath: join(root, ".goribu/dist/goribu_basic_app/wrangler.json") }] });
  try {
    const { url } = await harness.listen();
    for (const [path, style, otherStyle] of [["/", "home", "greeting"], ["/greet?name=CSS", "greeting", "home"]]) {
      const response = await fetch(new URL(path, url));
      expect(response.status).toBe(200);
      const html = await response.text();
      if (path === "/") expect(html).toBe(readFileSync(join(clientDir, "index.html"), "utf8"));
      const dom = new JSDOM(html);
      try {
        const document = dom.window.document;
        const sheets = [...document.querySelectorAll('link[rel="stylesheet"]')];
        expect(sheets.length).toBeGreaterThanOrEqual(2);
        let css = "";
        for (const sheet of sheets) {
          const href = sheet.getAttribute("href");
          const asset = await fetch(new URL(href, url));
          expect(asset.status, href).toBe(200);
          expect(asset.headers.get("cache-control")).toContain("immutable");
          const source = await asset.text();
          expect(source).toBe(readFileSync(join(clientDir, href.slice(1)), "utf8"));
          css += source;
        }
        expect(css).toMatch(/--shared-style:\s*global/);
        expect(css).toMatch(new RegExp(`--page-style:\\s*${style}`));
        expect(css).not.toMatch(new RegExp(`--page-style:\\s*${otherStyle}`));
        if (path === "/") {
          expect(css).toMatch(/--palette:\s*home/);
          const image = /url\(["']?([^"')]+\.svg)["']?\)/.exec(css)?.[1];
          expect(image).toMatch(/^\/_goribu\/assets\/tile-[A-Za-z0-9_-]{8}\.svg$/);
          const asset = await fetch(new URL(image, url));
          expect(asset.status).toBe(200);
          expect(await asset.text()).toBe(readFileSync(join(root, "src/tile.svg"), "utf8"));
        } else {
          expect(document.querySelector("h1").textContent).toBe("Hello, CSS");
          expect(css).toContain(`.${document.querySelector("h1").className}`);
        }
        for (const element of document.querySelectorAll('script[type="module"], link[rel="modulepreload"]')) {
          const href = element.getAttribute("src") ?? element.getAttribute("href");
          const asset = await fetch(new URL(href, url));
          expect(asset.status, href).toBe(200);
          await asset.text();
        }
      } finally {
        dom.window.close();
      }
    }
  } finally {
    await harness.close();
  }
}, 30000);
