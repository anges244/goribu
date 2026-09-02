import { Suspense, createElement as h, use } from "react";
import { describe, expect, it } from "vitest";
import { ClientEntry } from "goribu";
import {
  PROPS_SCRIPT_ID,
  ROUTE_SCRIPT_ID,
} from "../src/rendering/render-context.js";
import { renderPage } from "../src/rendering/render-page.js";

const decoder = new TextDecoder();

function CustomDocument({ children }) {
  return h(
    "html",
    { lang: "en" },
    h("head", null, h("meta", { charSet: "utf-8" })),
    h(
      "body",
      null,
      h("div", { id: "root" }, children),
      h(ClientEntry, { src: "/src/client-entry.js" }),
    ),
  );
}

describe("renderPage hydration data", () => {
  it("streams a custom Document with escaped inert data and its module entry", async () => {
    const props = {
      title: "Hydrated",
      markup: "</script><script>globalThis.pwned = true</script>",
    };
    const response = await renderPage({
      Page: ({ title }) => h("h1", null, title),
      Document: CustomDocument,
      routeId: "src/routes/index.jsx",
      props,
      headers: { "x-rendered": "yes" },
    });

    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(response.bodyUsed).toBe(false);
    expect(response.headers.get("x-rendered")).toBe("yes");

    const html = await response.text();
    expect(html).toContain('<div id="root"><h1>Hydrated</h1></div>');
    expect(readJsonScript(html, ROUTE_SCRIPT_ID)).toEqual({
      id: "src/routes/index.jsx",
    });
    expect(readJsonScript(html, PROPS_SCRIPT_ID)).toEqual(props);
    expect(html).toContain(
      '<script type="module" src="/src/client-entry.js"></script>',
    );
    expect(html).not.toContain("</script><script>globalThis.pwned");
  });

  it("resolves the production entry and matched page preload through render data", async () => {
    const response = await renderPage({
      Page: () => h("h1", null, "Hydrated"),
      Document: CustomDocument,
      routeId: "src/routes/index.jsx",
      clientAssetManifest: {
        entry: {
          file: "_goribu/assets/client-entry-hash.js",
          imports: ["_goribu/assets/shared-hash.js"],
        },
        pages: {
          "src/routes/index.jsx": {
            file: "_goribu/assets/index-hash.js",
            imports: ["_goribu/assets/shared-hash.js"],
          },
        },
      },
      clientAssetBase: "/app",
    });
    const html = await response.text();

    expect(html).toContain(
      '<script type="module" src="/app/_goribu/assets/client-entry-hash.js"></script>',
    );
    expect(html).toContain(
      '<link rel="modulepreload" href="/app/_goribu/assets/index-hash.js"/>',
    );
    expect(html).toContain(
      '<link rel="modulepreload" href="/app/_goribu/assets/shared-hash.js"/>',
    );
    expect(html).not.toContain('/src/client-entry.js');
  });

  it("returns the streamed shell before suspended page work completes", async () => {
    let resolveContent;
    const content = new Promise((resolve) => {
      resolveContent = resolve;
    });

    function DeferredContent() {
      return h("p", null, use(content));
    }
    function Page() {
      return h(
        Suspense,
        { fallback: h("p", null, "Loading") },
        h(DeferredContent),
      );
    }

    const response = await renderPage({
      Page,
      Document: CustomDocument,
      routeId: "src/routes/stream.jsx",
      props: {},
    });
    const reader = response.body.getReader();
    const first = await reader.read();
    let html = decoder.decode(first.value, { stream: true });

    expect(first.done).toBe(false);
    expect(html).toContain("Loading");
    expect(html).toContain(`id="${ROUTE_SCRIPT_ID}"`);
    expect(html).toContain('src="/src/client-entry.js"');

    resolveContent("Ready");
    html += await readRemaining(reader);
    expect(html).toContain("Ready");
  });
});

function readJsonScript(html, id) {
  const match = html.match(
    new RegExp(
      `<script id="${id}" type="application/json">([\\s\\S]*?)<\\/script>`,
    ),
  );
  expect(match).not.toBeNull();
  return JSON.parse(match[1]);
}

async function readRemaining(reader) {
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) return text + decoder.decode();
    text += decoder.decode(chunk.value, { stream: true });
  }
}
