import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement as h } from "react";
import { afterEach, expect, it } from "vitest";
import { renderPage } from "../src/rendering/render-page.js";
import { DefaultDocument } from "../src/rendering/document.js";
import { createStaticNavigationOutput } from "../src/build/static-navigation-output.js";

const roots = [];
const buildId = "1234567890abcdef1234567890abcdef";
const route = { id: "src/routes/index.jsx", pathname: "/" };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function setup() {
  const root = mkdtempSync(join(tmpdir(), "goribu-static-data-"));
  roots.push(root);
  mkdirSync(join(root, "_goribu"));
  writeFileSync(join(root, "_goribu/navigation.json"), JSON.stringify({ buildId, routes: null }));
  return { root, output: createStaticNavigationOutput(root) };
}
async function render(attributes = undefined) {
  const props = { text: '</script><script id="__GORIBU_PROPS__">attack</script>', value: Math.random() };
  const response = await renderPage({
    Page: ({ text }) => h("p", attributes, text), Document: DefaultDocument,
    routeId: route.id, props, metadata: { title: "Saved metadata" },
    clientAssetManifest: { navigationBuildId: buildId, entry: { file: "_goribu/assets/entry-1234abcd.js" } },
  });
  return { html: await response.text(), props };
}

it("saves exactly the hydration props and metadata from the completed HTML render", async () => {
  const { root, output } = setup();
  const { html, props } = await render();
  await output.write(route, html);
  output.finish();
  const manifest = JSON.parse(readFileSync(join(root, "_goribu/navigation.json"), "utf8"));
  const data = JSON.parse(readFileSync(join(root, manifest.routes["/"].asset), "utf8"));
  expect(data).toEqual({ kind: "render", routeId: route.id, props, meta: { title: "Saved metadata" }, status: 200, buildId });
});

it("accepts data attributes whose values match the reserved hydration IDs", async () => {
  const { root, output } = setup();
  const { html, props } = await render({
    "data-id": "__GORIBU_PROPS__",
    "data-route-id": "__GORIBU_ROUTE__",
  });
  await output.write(route, html);
  output.finish();
  const manifest = JSON.parse(readFileSync(join(root, "_goribu/navigation.json"), "utf8"));
  const data = JSON.parse(readFileSync(join(root, manifest.routes["/"].asset), "utf8"));
  expect(data.props).toEqual(props);
});

it("refuses ambiguous, missing, incompatible, or invalid hydration data before confirming a route", async () => {
  const { root, output } = setup();
  const { html } = await render();
  for (const invalid of [
    html.replace('id="__GORIBU_PROPS__"', 'id="missing"'),
    html + '<script id="__GORIBU_PROPS__" type="application/json">{}</script>',
    html.replace("<body>", '<body><div\n id="__GORIBU_PROPS__"></div>'),
    html.replace(buildId, "different-build"),
    html.replace('"status":200', '"status":500'),
    html.replace('"meta":{"title":"Saved metadata"}', '"meta":{"title":42}'),
  ]) await expect(output.write(route, invalid)).rejects.toThrow("[Goribu]");
  output.finish();
  expect(JSON.parse(readFileSync(join(root, "_goribu/navigation.json"), "utf8")).routes).toEqual({});
});
