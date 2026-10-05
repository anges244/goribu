import {
  cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { expect, it, vi } from "vitest";
import { goribu } from "goribu/vite";
import { createClientRouteModuleId } from "../src/build/create-client-boundary-plugin.js";

it("prebundles lazy-page React imports with the bootstrap on a cold dev start", async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "goribu-cold-client-"));
  let server;
  try {
    server = await createServer({
      configFile: false,
      root: fileURLToPath(new URL("../../../fixtures/basic-app/", import.meta.url)),
      cacheDir,
      logLevel: "silent",
      // Exercise the browser plugins without starting a Worker or HTTP listener.
      plugins: goribu().filter((plugin) => plugin.name?.startsWith("goribu")),
      server: { middlewareMode: true, watch: null },
    });
    const optimizer = server.environments.client.depsOptimizer;
    await optimizer.init();
    await optimizer.scanProcessing;
    optimizer.run();
    await vi.waitFor(() => {
      expect(optimizer.metadata.optimized["goribu/client"]).toBeDefined();
    }, { timeout: 10000 });

    // Pages are behind a virtual dynamic import and have not been requested.
    // Their React imports must already be ready, not trigger another prebundle
    // after the browser has started executing the hydration runtime.
    const { optimized } = optimizer.metadata;
    for (const id of ["goribu", "react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"]) {
      expect(optimized[id], id).toBeDefined();
      expect(readFileSync(optimized[id].file, "utf8").length).toBeGreaterThan(0);
    }
    const firstHash = optimizer.metadata.browserHash;
    const entry = await server.transformRequest("/src/setup/client-entry.js");
    expect(entry.code).toContain("goribu_client.js");
    const page = await server.transformRequest("/src/routes/index.jsx");
    expect(page.code).toContain("react.js");
    expect(page.code).toContain("react_jsx-dev-runtime.js");
    expect(Object.keys(optimizer.metadata.discovered)).toEqual([]);
    expect(optimizer.metadata.browserHash).toBe(firstHash);
  } finally {
    await server?.close();
    rmSync(cacheDir, { recursive: true, force: true });
  }
}, 20000);

it("optimizes packages behind lazy pages at dev startup, before the first page request", async () => {
  const fixture = fileURLToPath(new URL("../../../fixtures/basic-app/", import.meta.url));
  const root = mkdtempSync(join(tmpdir(), "goribu-page-dependencies-"));
  let server;
  try {
    cpSync(join(fixture, "src"), join(root, "src"), { recursive: true });
    for (const name of ["package.json", "goribu.config.js"]) cpSync(join(fixture, name), join(root, name));
    // A real package directory, so Vite optimizes it rather than treating it
    // as linked source. Importing React DOM's root entry reshapes the chunks
    // optimized for the bootstrap, which is what reloaded a running page.
    mkdirSync(join(root, "node_modules/editor-ui"), { recursive: true });
    for (const name of ["goribu", "react", "react-dom"]) {
      symlinkSync(realpathSync(join(fixture, "node_modules", name)), join(root, "node_modules", name), "dir");
    }
    writeFileSync(join(root, "node_modules/editor-ui/package.json"),
      JSON.stringify({ name: "editor-ui", type: "module", main: "index.js" }));
    writeFileSync(join(root, "node_modules/editor-ui/index.js"),
      'import { createElement } from "react"; import { flushSync } from "react-dom";\n' +
      'export const Editor = () => createElement("button", { onClick: () => flushSync(() => {}) }, "Edit");');
    mkdirSync(join(root, "src/routes/editor"));
    writeFileSync(join(root, "src/routes/editor/[id].jsx"),
      'import { Editor } from "editor-ui";\nexport default function EditorPage() { return <Editor />; }');

    server = await createServer({
      configFile: false, root, logLevel: "silent",
      plugins: goribu().filter((plugin) => plugin.name?.startsWith("goribu")),
      server: { host: "127.0.0.1", port: 0, watch: null },
    });
    await server.listen();
    const optimizer = server.environments.client.depsOptimizer;
    await vi.waitFor(() => {
      expect(optimizer.metadata.optimized["editor-ui"]).toBeDefined();
    }, { timeout: 10000 });

    // The browser's first request for the page finds nothing left to optimize.
    const browserHash = optimizer.metadata.browserHash;
    await server.environments.client.transformRequest(
      createClientRouteModuleId(join(root, "src/routes/editor/[id].jsx")));
    expect(Object.keys(optimizer.metadata.discovered)).toEqual([]);
    expect(optimizer.metadata.browserHash).toBe(browserHash);
  } finally {
    await server?.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 20000);
