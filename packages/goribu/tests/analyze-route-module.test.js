import { describe, expect, it } from "vitest";
import { analyzeRouteModule } from "../src/routing/analyze-route-module.js";

describe("analyzeRouteModule", () => {
  it("extracts page, handler, and prerender facts from TSX", () => {
    const analysis = analyzeRouteModule(
      `
        type Props = { title: string };
        const save = async () => new Response(null);
        export { save as POST };
        export async function GET() { return new Response(null); }
        export const prerender = false;
        export default function Page(props: Props) {
          return <h1>{props.title}</h1>;
        }
      `,
      "src/routes/posts.tsx",
    );

    expect(analysis).toEqual({
      hasDefaultExport: true,
      methods: ["GET", "POST"],
      prerender: false,
    });
  });

  it("recognizes handlers on an API-only route", () => {
    expect(
      analyzeRouteModule(
        `export function GET() { return new Response(null); }`,
        "src/routes/api/health.js",
      ),
    ).toEqual({
      hasDefaultExport: false,
      methods: ["GET"],
      prerender: null,
    });
  });

  it("recognizes a default re-export without inventing handlers", () => {
    expect(
      analyzeRouteModule(
        `export { default } from "./page.js";`,
        "src/routes/index.js",
      ),
    ).toEqual({
      hasDefaultExport: true,
      methods: [],
      prerender: null,
    });
  });

  it("ignores type-only exports with runtime route names", () => {
    expect(
      analyzeRouteModule(
        `
          interface Page {}
          type Handler = () => void;
          type Setting = boolean;
          export type { Page as default, Handler as GET, Setting as prerender };
          export { type Handler as POST };
          export declare function HEAD(): void;
          export declare const OPTIONS: Handler;
        `,
        "src/routes/types.ts",
      ),
    ).toEqual({
      hasDefaultExport: false,
      methods: [],
      prerender: null,
    });

    expect(
      analyzeRouteModule(
        `
          interface Page {}
          type Handler = () => void;
          declare function save(): void;
          import type { Remote } from "./types.js";
          export { Page as default, Handler as GET, save as POST, Remote as HEAD };
        `,
        "src/routes/aliases.ts",
      ),
    ).toEqual({
      hasDefaultExport: false,
      methods: [],
      prerender: null,
    });

    expect(
      analyzeRouteModule(
        `export default interface Page {}`,
        "src/routes/interface.ts",
      ).hasDefaultExport,
    ).toBe(false);

    expect(
      analyzeRouteModule(
        `declare const Page: unknown; export default Page;`,
        "src/routes/ambient.ts",
      ).hasDefaultExport,
    ).toBe(false);
  });

  it("accepts both boolean prerender overrides", () => {
    for (const value of [true, false]) {
      expect(
        analyzeRouteModule(
          `export const prerender = ${value};`,
          "src/routes/index.js",
        ).prerender,
      ).toBe(value);
    }
  });

  it("rejects a dynamic prerender value with the canonical repair", () => {
    expect(() =>
      analyzeRouteModule(
        `export const prerender = process.env.PRERENDER;`,
        "src/routes/index.js",
      ),
    ).toThrow(
      "[Goribu] Invalid prerender export in \"src/routes/index.js\". Use `export const prerender = true`",
    );
  });

  it("rejects an aliased prerender export with the canonical repair", () => {
    expect(() =>
      analyzeRouteModule(
        `const setting = true; export { setting as prerender };`,
        "src/routes/index.js",
      ),
    ).toThrow(
      "[Goribu] Invalid prerender export in \"src/routes/index.js\". Use `export const prerender = true`",
    );
  });

  it("turns parser failures into route-specific teaching errors", () => {
    expect(() =>
      analyzeRouteModule(
        `export default function Page(`,
        "src/routes/broken.jsx",
      ),
    ).toThrow(
      /\[Goribu\] Could not parse route module "src\/routes\/broken\.jsx".*Fix the syntax error/,
    );
  });
});
