import { describe, expect, it } from "vitest";
import { analyzeRouteModule } from "../src/routing/analyze-route-module.js";

describe("analyzeRouteModule", () => {
  it("rejects incorrectly cased runtime handler exports with the filename and repair", () => {
    const cases = [
      ['export function post() {}', 'post', 'POST'],
      ['export const Get = () => {};', 'Get', 'GET'],
      ['const save = () => {}; export { save as put };', 'put', 'PUT'],
      ['export { save as pAtCh } from "./actions.js";', 'pAtCh', 'PATCH'],
      ['export { remove as "delete" } from "./actions.js";', 'delete', 'DELETE'],
      ['export class Head {}', 'Head', 'HEAD'],
      ['export const { nested: [Options = () => {}] } = source;', 'Options', 'OPTIONS'],
      ['export const [post] = actions;', 'post', 'POST'],
      ['export const { ...post } = actions;', 'post', 'POST'],
      ['export enum post { Save }', 'post', 'POST'],
      ['export * as post from "./actions.js";', 'post', 'POST'],
      ['export function POST() {} export function post() {}', 'post', 'POST'],
    ];
    for (const [source, name, method] of cases) {
      // A page used to let the typo silently become a static route with no handler.
      expect(() => analyzeRouteModule(
        `export default function Page() { return null; } ${source}`,
        "src/routes/items.tsx",
      ), source).toThrow(
        `[Goribu] Route "src/routes/items.tsx" exports "${name}". HTTP handlers must use uppercase names. Rename "${name}" to "${method}".`,
      );
    }
  });

  it("checks public names without rejecting local helpers, other exports, or erased types", () => {
    expect(analyzeRouteModule(`
      function post() {}
      export { post as POST };
      export const { post: PUT } = { post };
      export default function get() { return null; }
      export const postCount = 0;
      export const { post: helper } = { post };
      export type { post } from "./types.js";
      export { type put } from "./types.js";
      export interface patch {}
      export declare function head(): void;
      export declare const options: unknown;
      type DeleteHandler = () => void;
      import type { Remote } from "./types.js";
      export { DeleteHandler as Delete, Remote as Get };
    `, "src/routes/items.tsx")).toEqual({
      hasDefaultExport: true, methods: ["POST", "PUT"], prerender: null,
    });
  });

  it("ignores erased namespaces and their local export aliases", () => {
    expect(analyzeRouteModule(`
      export namespace post { export type Payload = { title: string }; }
      export namespace Get {
        export namespace Payload { export interface Fields { title: string } }
      }
      export namespace patch.Payload { export type Title = string; }
      export namespace put {}
      namespace Types { export interface Payload { title: string } }
      export { Types as Delete, Types as POST, Types as prerender, Types as default };
    `, "src/routes/types.ts")).toEqual({
      hasDefaultExport: false, methods: [], prerender: null,
    });
  });

  it("still rejects runtime namespaces, including merged type and value declarations", () => {
    const cases = [
      'export namespace post { export const value = 1; }',
      'export namespace post { export namespace Nested { export const value = 1; } }',
      'export namespace post { export const enum Option { Save } }',
      'export namespace post { console.log("side effect"); }',
      'export namespace post { ; }',
      'export namespace post { export declare function save(): void; }',
      'export namespace post { declare const value: number; }',
      'namespace Types { export type Payload = string; } namespace Types { export const value = 1; } export { Types as post };',
      'namespace Types { export const value = 1; } namespace Types { export type Payload = string; } export { Types as post };',
      'function Types() {} namespace Types { export type Payload = string; } export { Types as post };',
    ];
    for (const source of cases) {
      expect(() => analyzeRouteModule(source, "src/routes/items.ts"), source)
        .toThrow('HTTP handlers must use uppercase names. Rename "post" to "POST".');
    }
  });

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
