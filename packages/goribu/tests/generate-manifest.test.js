import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { generateManifest } from "../src/routing/generate-manifest.js";

const cleanupDirs = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("generateManifest", () => {
  it("combines source identity, URL shape, exports, and specificity order", () => {
    const { projectRoot, routesDir } = createRoutes({
      "[section]/new.js": `export function GET() {}`,
      "index.jsx": `export default function Home() { return <h1>Home</h1>; }`,
      "posts/[id].tsx": `
        type Props = { id: string };
        export function POST() {}
        export default function Post(props: Props) { return <p>{props.id}</p>; }
      `,
      "posts/index.js": `export function GET() {}`,
      "posts/new.jsx": `
        export function GET() {}
        export default function NewPost() { return <h1>New</h1>; }
      `,
    });

    const manifest = generateManifest({ routesDir, projectRoot });

    expect(manifest.map((route) => route.pattern)).toEqual([
      "/",
      "/posts",
      "/posts/new",
      "/posts/:id",
      "/:section/new",
    ]);
    expect(manifest.find((route) => route.pattern === "/posts/:id")).toEqual({
      id: "src/routes/posts/[id].tsx",
      filePath: join(routesDir, "posts/[id].tsx"),
      pattern: "/posts/:id",
      segments: [
        { type: "static", value: "posts" },
        { type: "dynamic", name: "id" },
      ],
      hasDefaultExport: true,
      methods: ["POST"],
      prerenderOverride: null,
      prerenderEligible: true,
    });
  });

  it("applies the complete syntactic prerender rule without code heuristics", () => {
    const { projectRoot, routesDir } = createRoutes({
      "automatic.jsx": `
        import { loadData } from "./data.server.js";
        export function POST() {}
        export default function Page() { return loadData(); }
      `,
      "disabled.jsx": `
        export const prerender = false;
        export default function Page() { return null; }
      `,
      "explicit-get.jsx": `
        export function GET() {}
        export default function Page() { return null; }
      `,
      "forced.js": `
        export const prerender = true;
        export function GET() {}
      `,
    });

    expect(
      Object.fromEntries(
        generateManifest({ routesDir, projectRoot }).map((route) => [
          route.pattern,
          {
            override: route.prerenderOverride,
            eligible: route.prerenderEligible,
          },
        ]),
      ),
    ).toEqual({
      "/automatic": { override: null, eligible: true },
      "/disabled": { override: false, eligible: false },
      "/explicit-get": { override: null, eligible: false },
      "/forced": { override: true, eligible: true },
    });
  });

  it("rejects both duplicate paths and parameter-name-only distinctions", () => {
    const duplicatePath = createRoutes({
      "account.js": `export function GET() {}`,
      "account/index.js": `export function GET() {}`,
    });
    const duplicateShape = createRoutes({
      "posts/[id].js": `export function GET() {}`,
      "posts/[slug].js": `export function GET() {}`,
    });

    expect(() =>
      generateManifest({
        routesDir: duplicatePath.routesDir,
        projectRoot: duplicatePath.projectRoot,
      }),
    ).toThrow(
      /\[Goribu\] Route conflict:.*src\/routes\/account\.js.*src\/routes\/account\/index\.js.*remove or rename/s,
    );
    expect(() =>
      generateManifest({
        routesDir: duplicateShape.routesDir,
        projectRoot: duplicateShape.projectRoot,
      }),
    ).toThrow(
      /\[Goribu\] Route conflict:.*\/posts\/:id.*\/posts\/:slug.*parameter names do not distinguish/s,
    );
  });

  it("rejects unsupported dynamic segment syntax with a repair", () => {
    const { projectRoot, routesDir } = createRoutes({
      "posts/[...slug].jsx": `export default function Post() { return null; }`,
    });

    expect(() => generateManifest({ routesDir, projectRoot })).toThrow(
      "[Goribu] Unsupported route segment \"[...slug]\" in \"src/routes/posts/[...slug].jsx\". Use a static name or one dynamic `[param]` segment",
    );
  });

  it("derives route IDs from the real project-relative source path", () => {
    const { projectRoot, routesDir } = createRoutes(
      { "dashboard.js": `export function GET() {}` },
      "apps/admin/pages",
    );

    expect(generateManifest({ routesDir, projectRoot })[0].id).toBe(
      "apps/admin/pages/dashboard.js",
    );
  });

  it("rejects route directories outside the project root before scanning", () => {
    const { projectRoot, routesDir } = createRoutes({
      "index.js": `export function GET() {}`,
    });

    expect(() =>
      generateManifest({
        routesDir: projectRoot,
        projectRoot: routesDir,
      }),
    ).toThrow(
      /\[Goribu\] Cannot generate a route manifest because the routes directory .* is outside the project root .*Pass the correct routes directory and project root/s,
    );
  });

  it("rejects route modules that cannot render or handle a request", () => {
    const helperRoute = createRoutes({
      "helpers.js": `export const helper = 1;`,
    });
    const typeOnlyRoute = createRoutes({
      "types.ts": `
        interface Page {}
        type Handler = () => void;
        export { Handler as GET, Page as default };
      `,
    });

    expect(() => generateManifest(helperRoute)).toThrow(
      "[Goribu] Route module \"src/routes/helpers.js\" exports neither a default page nor an HTTP handler. Add a default export, export one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, or move the file outside the routes directory.",
    );
    expect(() => generateManifest(typeOnlyRoute)).toThrow(
      "[Goribu] Route module \"src/routes/types.ts\" exports neither a default page nor an HTTP handler.",
    );
  });

  it("rejects duplicate parameter names within one route", () => {
    const { projectRoot, routesDir } = createRoutes({
      "users/[id]/posts/[id].js": `export function GET() {}`,
    });

    expect(() => generateManifest({ routesDir, projectRoot })).toThrow(
      "[Goribu] Duplicate route parameter \"id\" in \"src/routes/users/[id]/posts/[id].js\". Rename each `[param]` segment so every parameter name is unique.",
    );
  });
});

function createRoutes(files, routesRelativePath = "src/routes") {
  const projectRoot = mkdtempSync(join(tmpdir(), "goribu-manifest-"));
  const routesDir = join(projectRoot, routesRelativePath);
  cleanupDirs.push(projectRoot);

  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = join(routesDir, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, source);
  }

  return { projectRoot, routesDir };
}
