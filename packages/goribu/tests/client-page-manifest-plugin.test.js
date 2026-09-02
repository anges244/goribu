import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLIENT_PAGE_MANIFEST_ID,
  createClientPageManifestPlugin,
} from "../src/build/create-client-page-manifest-plugin.js";

describe("createClientPageManifestPlugin", () => {
  it("resolves and loads the generated virtual page manifest", () => {
    const route = {
      id: "src/routes/index.jsx",
      filePath: resolve("/app/src/routes/index.jsx"),
      hasDefaultExport: true,
    };
    const plugin = createClientPageManifestPlugin([route]);
    const resolvedId = `\0${CLIENT_PAGE_MANIFEST_ID}`;

    expect(plugin.resolveId(CLIENT_PAGE_MANIFEST_ID)).toBe(resolvedId);
    expect(plugin.resolveId(resolvedId)).toBe(resolvedId);
    expect(plugin.resolveId("virtual:other")).toBeNull();
    expect(plugin.load(resolvedId)).toContain(JSON.stringify(route.id));
    expect(plugin.load("virtual:other")).toBeNull();
  });
});
