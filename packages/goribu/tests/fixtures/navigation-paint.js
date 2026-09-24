import { createElement as h, useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { createNavigationController } from "../../src/browser/create-navigation-controller.js";
import { Form } from "../../src/forms/form.js";
import { createLocatedPage } from "../../src/navigation/location-context.js";
import { installNavigationRuntime } from "../../src/navigation/navigation-runtime.js";

// Deliberately long pages make a destination painted at the previous page's
// scroll position observable. Rendering and navigation use real React/browser
// scheduling; no controller timing hooks are replaced.
function Page({ name, children }) {
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    if (name === "layout") setExpanded(true);
  }, [name]);
  return h("main", { "data-page": name },
    h("h1", null, `Page ${name}`),
    children,
    h("pre", null, h("code", null,
      h("span", { className: "keyword" }, "export"), " default function Page() {}")),
    h("div", { className: "space" }),
    (name !== "layout" || expanded) && h("h2", { id: "target" }, `Target ${name}`),
    h("pre", null, h("code", null, "A code sample at the destination anchor.")),
    h("div", { className: "space" }),
  );
}

function FormPage() {
  return h(Page, { name: "form" },
    h(Form, { method: "post", action: "/mutation" },
      h("button", { type: "submit", id: "mutation-submit" }, "Submit"),
    ),
    h(Form, { method: "get", action: "/b" },
      h("button", { type: "submit", id: "get-submit" }, "Search"),
    ),
  );
}

const root = createRoot(document.getElementById("root"));
flushSync(() => root.render(createLocatedPage(Page, { name: "a" }, location.href)));
const controller = createNavigationController({
  root,
  pageLoaders: {
    ...Object.fromEntries(["a", "b", "slow", "layout"].map((name) => [
      name, async () => ({ default: Page }),
    ])),
    form: async () => ({ default: FormPage }),
  },
});
installNavigationRuntime(controller);

window.navigationPaint = { controller, frames: [] };
function recordFrame(time) {
  const page = document.querySelector("[data-page]");
  const code = document.querySelector("pre");
  const keyword = document.querySelector(".keyword");
  window.navigationPaint.frames.push({
    time,
    page: page?.dataset.page,
    hash: location.hash,
    scrollY,
    anchorTop: document.getElementById("target")?.getBoundingClientRect().top,
    codeBackground: code && getComputedStyle(code).backgroundColor,
    keywordColor: keyword && getComputedStyle(keyword).color,
  });
  requestAnimationFrame(recordFrame);
}
requestAnimationFrame(recordFrame);
