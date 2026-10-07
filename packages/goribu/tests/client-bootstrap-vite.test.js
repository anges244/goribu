import { rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { goribu } from "goribu/vite";
import { CLIENT_PAGE_MANIFEST_ID } from "../src/build/create-client-page-manifest-plugin.js";
import { copyTestApp } from "./support/copy-test-app.js";

const fixture = fileURLToPath(
  new URL("../../../fixtures/basic-app/", import.meta.url),
);
let projectRoot, routesDir;

beforeAll(() => {
  projectRoot = copyTestApp(fixture, "goribu-bootstrap-test-");
  routesDir = join(projectRoot, "src", "routes");
});
afterAll(() => {
  if (projectRoot) rmSync(projectRoot, { recursive: true, force: true });
});

describe("client hydration bootstrap", () => {
  it("bundles the runtime and lazy fixture pages without API-only server code", async () => {
    const result = await build({
      configFile: false,
      root: projectRoot,
      logLevel: "silent",
      plugins: [goribu()],
      build: {
        minify: false,
        write: false,
        rollupOptions: {
          input: join(projectRoot, "src", "setup", "client-entry.js"),
          preserveEntrySignatures: "strict",
        },
      },
    });

    const outputs = Array.isArray(result) ? result : [result];
    const chunks = outputs.flatMap((output) =>
      output.output.filter((entry) => entry.type === "chunk"),
    );
    const bundledSource = chunks.map((chunk) => chunk.code).join("\n");
    const bundledModules = chunks.flatMap((chunk) => Object.keys(chunk.modules));
    const dynamicEntryModules = chunks
      .filter((chunk) => chunk.isDynamicEntry)
      .flatMap((chunk) => Object.keys(chunk.modules));

    expect(bundledModules).toContain(join(projectRoot, "src/setup/client-entry.js"));
    expect(bundledModules).toContain(
      fileURLToPath(new URL("../src/client.js", import.meta.url)),
    );
    expect(dynamicEntryModules).toContain(`\0${CLIENT_PAGE_MANIFEST_ID}`);
    expect(dynamicEntryModules).toContain(join(routesDir, "index.jsx"));
    expect(bundledModules).not.toContain(join(routesDir, "hello.js"));
    expect(bundledSource).toContain("hydrateRoot");
    expect(bundledSource).toContain("Hydration count:");
    expect(bundledSource).not.toContain("fixture-server-only-token");
  }, 15_000);
});
