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
      /\[Goribu\].*database\.server\.js.*reached client code.*browser\.js.*Keep server dependencies in handler-only code/s,
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

  it("rejects a used route import through a symlinked project root", async () => {
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
      /\[Goribu\].*handler\.server\.js.*reached client code.*routes\/index\.js/s,
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
  it("keeps rejecting leaks through ignored helpers and explains bare server imports", async () => {
    const root = makeProject({
      "src/routes/index.js": 'import { GET } from "./_lib/api.js"; export default () => GET();',
      "src/routes/_lib/api.js": 'import { secret } from "../../instrument.server.js"; export function GET() { return secret; }',
      "src/instrument.server.js": 'export const secret = "SERVER_SECRET";',
    });
    await expect(buildClient(root, createClientRouteModuleId(join(root, "src/routes/index.js")))).rejects.toThrow(
      /instrument\.server\.js.*reached client code.*_lib\/api\.js/s,
    );
    writeFileSync(join(root, "src/routes/index.js"), 'import "../instrument.server.js"; export default function Page() { return null; }');
    await expect(buildClient(root, createClientRouteModuleId(join(root, "src/routes/index.js")))).rejects.toThrow(
      /For a bare side-effect import, move it into a \.server helper used only by a handler/,
    );
  });

  it.each([
    {
      name: "reserved-name exports in ignored helper files",
      files: {
        "src/routes/index.js": 'import { GET, meta, uploads, prerender } from "./nested/_lib/api.js"; import { POST } from "./_helper.js"; export default () => GET() + meta + uploads + prerender + POST();',
        "src/routes/nested/_lib/api.js": 'export function GET() { return "HELPER_GET"; } export const meta = "HELPER_META", uploads = "HELPER_UPLOADS", prerender = "HELPER_PRERENDER";',
        "src/routes/_helper.js": 'export function POST() { return "HELPER_POST"; }',
      },
      markers: ["HELPER_GET", "HELPER_META", "HELPER_UPLOADS", "HELPER_PRERENDER", "HELPER_POST"],
    },
    {
      name: "barrels in ignored component folders",
      files: {
        "src/routes/index.js": 'import { Button } from "./_components/index.js"; export default Button;',
        "src/routes/_components/index.js": 'export * from "./Button.jsx";',
        "src/routes/_components/Button.jsx": 'export function Button() { return "HELPER_BUTTON"; }',
      },
      markers: ["HELPER_BUTTON"],
    },
  ])("preserves $name through a real client build", async ({ files, markers }) => {
    const root = makeProject(files, { symlinked: true });
    const chunks = await buildClient(root, createClientRouteModuleId(join(root, "src/routes/index.js")));
    const source = chunks.map((chunk) => chunk.code).join("\n");
    for (const marker of markers) expect(source).toContain(marker);
  });

  it("still separates server metadata in top-level error pages", async () => {
    for (const page of ["_404", "_500"]) {
      const root = makeProject({
        [`src/routes/${page}.jsx`]: 'import { title } from "../metadata.server.js"; export const meta = () => ({ title }); export default function Page() { return "ERROR_PAGE"; }',
        "src/metadata.server.js": 'export const title = "SERVER_METADATA";',
      });
      const chunks = await buildClient(root, createClientRouteModuleId(join(root, `src/routes/${page}.jsx`)));
      const source = chunks.map((chunk) => chunk.code).join("\n");
      expect(source).toContain("ERROR_PAGE");
      expect(source).not.toContain("SERVER_METADATA");
    }
  });

  it("never resolves nested server helpers or server-only initializer calls in the browser build", async () => {
    const root = makeProject({
      "src/routes/index.js": `
        import { body, policy } from "../body.server.js";
        export function GET(req, res) { return res.render(body()); }
        export const uploads = policy();
        export default function Page() { return "CLIENT_PAGE"; }
      `,
      "src/body.server.js": 'import { image } from "./images.server.js"; export function body() { return image; } export function policy() { return {}; }',
      "src/images.server.js": 'throw new Error("SERVER_MODULE_EXECUTED"); export const image = "SERVER_SECRET";',
    });
    const chunks = await buildClient(root, createClientRouteModuleId(join(root, "src/routes/index.js")));
    expect(chunks.map((chunk) => chunk.code).join("\n")).toContain("CLIENT_PAGE");
    expect(chunks.flatMap((chunk) => Object.keys(chunk.modules)).some((id) => id.includes(".server."))).toBe(false);
  });

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
