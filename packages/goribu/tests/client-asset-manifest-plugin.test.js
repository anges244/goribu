import { describe, expect, it, vi } from "vitest";
import { createClientAssetManifestPlugin } from "../src/build/create-client-asset-manifest-plugin.js";
import { createClientRouteModuleId } from "../src/build/create-client-boundary-plugin.js";

const routeFilePath = "/app/src/routes/index.jsx";
const route = { id: "src/routes/index.jsx", filePath: routeFilePath };

function chunk(fileName, overrides = {}) {
  return {
    type: "chunk",
    fileName,
    isEntry: false,
    isDynamicEntry: false,
    imports: [],
    viteMetadata: { importedCss: new Set() },
    ...overrides,
  };
}

describe("createClientAssetManifestPlugin", () => {
  it("captures one entry and the transitive graph for each emitted page", () => {
    const onManifest = vi.fn();
    const plugin = createClientAssetManifestPlugin({
      manifest: [route],
      onManifest,
    });
    const bundle = {
      "entry-hash.js": chunk("entry-hash.js", {
        isEntry: true,
        imports: ["shared-hash.js"],
      }),
      "shared-hash.js": chunk("shared-hash.js", {
        viteMetadata: { importedCss: new Set(["shared-hash.css"]) },
      }),
      "page-hash.js": chunk("page-hash.js", {
        isDynamicEntry: true,
        facadeModuleId: `\0${createClientRouteModuleId(routeFilePath)}`,
        imports: ["shared-hash.js"],
      }),
    };

    plugin.generateBundle({}, bundle);

    expect(onManifest).toHaveBeenCalledWith({
      entry: {
        file: "entry-hash.js",
        imports: ["shared-hash.js"],
        css: ["shared-hash.css"],
      },
      pages: {
        "src/routes/index.jsx": {
          file: "page-hash.js",
          imports: ["shared-hash.js"],
          css: ["shared-hash.css"],
        },
      },
    });
  });

  it("fails closed for a missing entry, multiple entries, and an unknown page route", () => {
    const create = () =>
      createClientAssetManifestPlugin({ manifest: [route], onManifest() {} });

    expect(() => create().generateBundle({}, {})).toThrow(/no entry chunk/);
    expect(() =>
      create().generateBundle(
        {},
        {
          "entry-a.js": chunk("entry-a.js", { isEntry: true }),
          "entry-b.js": chunk("entry-b.js", { isEntry: true }),
        },
      ),
    ).toThrow(/more than one entry chunk/);
    expect(() =>
      create().generateBundle(
        {},
        {
          "entry.js": chunk("entry.js", { isEntry: true }),
          "unknown.js": chunk("unknown.js", {
            isDynamicEntry: true,
            facadeModuleId: `\0${createClientRouteModuleId("/app/src/routes/unknown.jsx")}`,
          }),
        },
      ),
    ).toThrow(/absent from the route manifest/);
  });

  it("requires the route manifest and capture callback", () => {
    expect(() => createClientAssetManifestPlugin()).toThrow(/requires manifest/);
    expect(() => createClientAssetManifestPlugin({ manifest: [] })).toThrow(
      /requires onManifest/,
    );
  });
});
