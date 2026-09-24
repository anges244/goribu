import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { expect, it, vi } from "vitest";
import { goribu } from "goribu/vite";

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
