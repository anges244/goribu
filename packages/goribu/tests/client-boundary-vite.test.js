import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { build } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import {
  createClientBoundaryPlugin,
  createClientRouteModuleId,
  routeFilePathFromClientModuleId,
} from "../src/build/create-client-boundary-plugin.js";

const created = [];

function makeProject(files, { symlinked = false } = {}) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "goribu-client-boundary-"));
  created.push(temporaryRoot);

  let root = temporaryRoot;
  if (symlinked) {
    const realRoot = join(temporaryRoot, "real-project");
    root = join(temporaryRoot, "linked-project");
    mkdirSync(realRoot, { recursive: true });
    symlinkSync(realRoot, root, "dir");
  }

  mkdirSync(join(root, "src", "routes"), { recursive: true });

  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = join(root, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, source);
  }

  return root;
}

afterEach(() => {
  for (const root of created.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Vite client server-only boundary", () => {
  it("rejects a transitive server module imported through browser code", async () => {
    const root = makeProject({
      "src/setup/client-entry.js": 'import "../browser.js";\n',
      "src/browser.js":
        'import { secret } from "./database.server.js";\nconsole.log(secret);\n',
      "src/database.server.js": 'export const secret = "DATABASE_SECRET";\n',
    });

    await expect(buildClient(root, "src/setup/client-entry.js")).rejects.toThrow(
      /\[Goribu\].*database\.server\.js.*reached client code.*browser\.js.*Move the import into a route handler/s,
    );
  });

  it("tree-shakes an unused route import through a symlinked project root", async () => {
    const root = makeProject(
      {
        "src/routes/index.js":
          'import { secret } from "./handler.server.js";\nexport default "CLIENT_ENTRY_SURVIVES";\n',
        "src/routes/handler.server.js":
          'console.log("SERVER_SIDE_EFFECT_MUST_NOT_SURVIVE");\nexport const secret = "HANDLER_SECRET_MUST_NOT_SURVIVE";\n',
      },
      { symlinked: true },
    );
    expect(realpathSync(root)).not.toBe(root);

    const chunks = await buildClient(root, "src/routes/index.js");
    const source = chunks.map((chunk) => chunk.code).join("\n");
    const modules = chunks.flatMap((chunk) => Object.keys(chunk.modules));

    expect(source).toContain("CLIENT_ENTRY_SURVIVES");
    expect(source).not.toContain("SERVER_SIDE_EFFECT_MUST_NOT_SURVIVE");
    expect(source).not.toContain("HANDLER_SECRET_MUST_NOT_SURVIVE");
    expect(modules).not.toContain(
      realpathSync(join(root, "src", "routes", "handler.server.js")),
    );
  });

  it("audits a used route import through a symlinked project root", async () => {
    const root = makeProject(
      {
        "src/routes/index.js":
          'import { secret } from "./handler.server.js";\nexport default secret;\n',
        "src/routes/handler.server.js":
          'export const secret = "HANDLER_SECRET";\n',
      },
      { symlinked: true },
    );

    await expect(buildClient(root, "src/routes/index.js")).rejects.toThrow(
      /\[Goribu\].*handler\.server\.js.*reached client code.*generated client bundle/s,
    );
  });

  it("rejects case-variant server module names", async () => {
    const root = makeProject({
      "src/setup/client-entry.js":
        'import { secret } from "../Database.Server.JS";\nconsole.log(secret);\n',
      "src/Database.Server.JS": 'export const secret = "CASE_SECRET";\n',
    });

    await expect(buildClient(root, "src/setup/client-entry.js")).rejects.toThrow(
      /\[Goribu\].*Database\.Server\.JS.*reached client code.*client-entry\.js/s,
    );
  });
});

describe("virtual client-route module ID", () => {
  it("mints and recovers an absolute route file path", () => {
    const routeFilePath = "/app/src/routes/index.js";
    const moduleId = createClientRouteModuleId(routeFilePath);

    expect(moduleId).toBe(
      `virtual:goribu/client-route:${encodeURIComponent(routeFilePath)}`,
    );
    expect(routeFilePathFromClientModuleId(`\0${moduleId}`)).toBe(routeFilePath);
  });

  it("rejects a non-absolute route file path", () => {
    expect(() => createClientRouteModuleId("routes/index.js")).toThrow(
      /\[Goribu\].*absolute route file path/,
    );
  });

  it("returns null for anything that is not a resolved virtual entry", () => {
    expect(routeFilePathFromClientModuleId(42)).toBeNull();
    expect(routeFilePathFromClientModuleId("/app/src/routes/index.js")).toBeNull();
    // Unresolved (no leading NUL): only resolved IDs front a chunk.
    expect(
      routeFilePathFromClientModuleId(
        createClientRouteModuleId("/app/src/routes/index.js"),
      ),
    ).toBeNull();
    // Malformed percent-encoding decodes to nothing usable.
    expect(
      routeFilePathFromClientModuleId("\0virtual:goribu/client-route:%zz"),
    ).toBeNull();
  });
});

describe("Vite client route boundary", () => {
  it("exposes only the page default, stripping named handlers and their server deps", async () => {
    const root = makeProject({
      "src/routes/index.js":
        'import { save } from "./handler.server.js";\n' +
        "export function POST() {\n" +
        "  return save();\n" +
        "}\n" +
        'export default "CLIENT_PAGE_VALUE_MUST_SURVIVE";\n',
      "src/routes/handler.server.js":
        'console.log("HANDLER_SIDE_EFFECT_MUST_NOT_RUN");\n' +
        'export function save() {\n  return "HANDLER_SECRET_MUST_NOT_LEAK";\n}\n',
    });

    const routeFilePath = realpathSync(join(root, "src", "routes", "index.js"));
    const chunks = await buildClient(
      root,
      createClientRouteModuleId(routeFilePath),
    );
    const source = chunks.map((chunk) => chunk.code).join("\n");
    const modules = chunks.flatMap((chunk) => Object.keys(chunk.modules));

    expect(source).toContain("CLIENT_PAGE_VALUE_MUST_SURVIVE");
    expect(source).not.toContain("HANDLER_SIDE_EFFECT_MUST_NOT_RUN");
    expect(source).not.toContain("HANDLER_SECRET_MUST_NOT_LEAK");
    expect(modules).not.toContain(
      realpathSync(join(root, "src", "routes", "handler.server.js")),
    );
  });

  it("refuses to load a virtual entry for a path outside the routes directory", async () => {
    const root = makeProject({
      "src/outside-page.js": 'export default "OUTSIDE";\n',
    });

    const outsidePath = realpathSync(join(root, "src", "outside-page.js"));
    await expect(
      buildClient(root, createClientRouteModuleId(outsidePath)),
    ).rejects.toThrow(
      /\[Goribu\].*outside the configured routes directory.*Regenerate client route entries/s,
    );
  });
});

async function buildClient(root, input) {
  const result = await build({
    configFile: false,
    root,
    logLevel: "silent",
    plugins: [
      createClientBoundaryPlugin({ routesDir: join(root, "src", "routes") }),
    ],
    build: {
      minify: false,
      write: false,
      rollupOptions: {
        input: input.startsWith("virtual:") ? input : join(root, input),
        preserveEntrySignatures: "strict",
      },
    },
  });

  const outputs = Array.isArray(result) ? result : [result];
  return outputs.flatMap((output) =>
    output.output.filter((entry) => entry.type === "chunk"),
  );
}
