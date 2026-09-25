import { expect, it, vi } from "vitest";
import { parse } from "@babel/parser";
import { createDevelopmentStylesPlugin } from "../src/build/create-development-styles-plugin.js";

vi.mock("@babel/parser", async (original) => {
  const parser = await original();
  return { ...parser, parse: vi.fn(parser.parse) };
});

it("reuses imports across requests and routes, but follows changed transforms and retries failures", async () => {
  const modules = new Map([
    ["/src/setup/client-entry.js", { code: 'import "./shared.js";' }],
    ["/src/routes/a.jsx", { code: 'export * from "../setup/shared.js";' }],
    ["/src/routes/b.jsx", { code: 'export { default } from "../setup/shared.js";' }],
    ["/src/setup/shared.js", { code: 'import "../first.css"; export default 1;' }],
  ]);
  let handler;
  const server = {
    config: { base: "/", logger: { error: vi.fn() } },
    environments: { client: { transformRequest: async (url) => modules.get(url) } },
    middlewares: { use(fn) { handler = fn; } },
  };
  const plugin = createDevelopmentStylesPlugin(new Set(["src/routes/a.jsx", "src/routes/b.jsx"]));
  plugin.configureServer(server);
  async function request(route = "a") {
    const response = { statusCode: 200, setHeader() {}, end(body) { this.body = body; } };
    await handler({ url: `/_goribu/dev-styles.css?route=src/routes/${route}.jsx`, method: "GET" }, response);
    return response;
  }
  vi.mocked(parse).mockClear();
  const cold = await Promise.all([request(), request()]);
  expect(cold.map((response) => response.body)).toEqual([
    '@import "/src/first.css?direct";',
    '@import "/src/first.css?direct";',
  ]);
  expect(parse).toHaveBeenCalledTimes(3);
  await Promise.all(Array.from({ length: 10 }, () => request()));
  expect(parse).toHaveBeenCalledTimes(3);
  expect((await request("b")).body).toContain("first.css");
  expect(parse).toHaveBeenCalledTimes(4);

  modules.set("/src/setup/shared.js", { code: 'import "../second.css";' });
  expect((await request()).body).toBe('@import "/src/second.css?direct";');
  expect(parse).toHaveBeenCalledTimes(5);
  modules.get("/src/setup/shared.js").code = 'import "./missing.js";';
  expect((await request()).statusCode).toBe(500);
  modules.set("/src/setup/missing.js", { code: 'import "../recovered.css";' });
  expect((await request()).body).toBe('@import "/src/recovered.css?direct";');

  const calls = vi.mocked(parse).mock.calls.length;
  expect((await request("unknown")).statusCode).toBe(404);
  expect(parse).toHaveBeenCalledTimes(calls);
  plugin.configureServer(server);
  expect((await request()).body).toContain("recovered.css");
  expect(vi.mocked(parse).mock.calls.length).toBeGreaterThan(calls);
});
