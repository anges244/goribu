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

function BrokenPage() {
  throw new Error("Intentional navigation recovery fixture failure.");
}

function LayoutFailure() {
  useLayoutEffect(() => {
    throw new Error("Intentional layout recovery fixture failure.");
  }, []);
  return h("p", null, "The submitting Form has been removed.");
}

function RecoveryForm(props) {
  useLayoutEffect(() => () => {
    if (window.navigationPaint.newerOnUnmount) {
      void window.navigationPaint.controller.navigate("/b");
    }
  }, []);
  return h(Form, props);
}

function FailingFormPage({ fail = false }) {
  if (fail === true) throw new Error("Intentional Form recovery fixture failure.");
  // React removes the old Form (aborting its signal) during the mutation phase,
  // before this new child's layout effect throws in the same response commit.
  if (fail === "layout") return h(Page, { name: "form-failure" }, h(LayoutFailure));
  const query = new URLSearchParams(location.search);
  query.set("from", "mutation");
  return h(Page, { name: "form-failure" },
    h(RecoveryForm, {
      method: "post",
      action: `/form-failure?${query}#target`,
      replace: query.get("replace") === "true",
      onResult: (result) => {
        window.navigationPaint.results.push({ ok: result.ok });
        sessionStorage.setItem("navigationPaintResults", JSON.stringify(window.navigationPaint.results));
      },
    }, h("button", { type: "submit", id: "failure-submit" }, "Submit render")),
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
    broken: async () => ({ default: BrokenPage }),
    "form-failure": async () => ({ default: FailingFormPage }),
  },
});
installNavigationRuntime(controller);

window.navigationPaint = { controller, frames: [], results: [] };
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
