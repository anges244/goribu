import { describe, expect, it } from "vitest";
import { planWorkerRouting } from "../src/build/plan-worker-routing.js";

function route(path, methods = ["GET"]) {
  const segments = path === "/" ? [] : path.slice(1).split("/").map((value) =>
    value.startsWith(":") ? { type: "dynamic", name: value.slice(1) } : { type: "static", value },
  );
  return { id: `src/routes${path}.js`, pattern: path, segments, methods, hasDefaultExport: false };
}

describe("Worker routing plan", () => {
  it("keeps actions, downgraded pages and framework endpoints while excluding confirmed static output", () => {
    const about = route("/products/about");
    const downgraded = route("/account");
    const plan = planWorkerRouting({
      manifest: [about, downgraded, route("/subscribe", ["POST"]), route("/products/:id")],
      staticRouteIds: new Set([about.id]),
      assetPaths: ["products/about.html", "_goribu/assets/client-abc.js", "404.html"],
      r2: true,
    });
    expect(plan.patterns).toEqual([
      "/404", "/_goribu/r2/file", "/_goribu/r2/upload", "/_goribu/worker-nav",
      "/account", "/account/", "/products/*", "/subscribe", "/subscribe/",
      "!/products/about", "!/products/about.html", "!/products/about/",
    ]);
    expect(plan.warnings).toEqual([]);
  });

  it("keeps asset-first routing under a root parameter without consuming the exclusion budget", () => {
    const home = route("/");
    const plan = planWorkerRouting({
      manifest: [home, route("/:slug")], staticRouteIds: new Set([home.id]),
      assetPaths: ["index.html", "favicon.ico", ...Array.from({ length: 100 }, (_, index) => `page-${index}.html`)],
    });
    expect(plan.patterns).toBeNull();
    expect(plan.notFoundHandling).toBe("none");
    expect(plan.warnings).toEqual([expect.stringMatching(/Keeping asset-first routing/)]);
  });

  it("does not let an asset exclusion hide a concrete action route", () => {
    expect(() => planWorkerRouting({
      manifest: [route("/subscribe", ["POST"])], assetPaths: ["subscribe.html"],
    })).toThrow(/Static asset.*conflicts with Worker route.*Rename or remove/);
    expect(() => planWorkerRouting({
      manifest: [route("/subscribe", ["POST"]), route("/:slug")], assetPaths: ["subscribe.html"],
    })).toThrow(/conflicts with Worker route/);
  });

  it("removes only redundant patterns and fails on the complete Cloudflare rule budget", () => {
    const manifest = [route("/products/:id"), route("/products/special"), route("/products/:id/edit")];
    expect(planWorkerRouting({ manifest }).patterns).toEqual(["/404", "/_goribu/worker-nav", "/products/*"]);
    const distinct = Array.from({ length: 50 }, (_, index) => route(`/action-${index}`, ["POST"]));
    expect(() => planWorkerRouting({ manifest: distinct })).toThrow(/102 patterns.*at most 100/);
    // Exclusions count too, including HTML aliases inside a dynamic prefix.
    expect(() => planWorkerRouting({
      manifest: [route("/products/:id")], assetPaths: Array.from({ length: 34 }, (_, index) => `products/page-${index}.html`),
    })).toThrow(/including static exclusions/);
  });

  it("matches browser pathname encoding without turning literal filename syntax into routing syntax", () => {
    const names = ["@user", "a+b", "x,y", "k=v", "a:b", "literal*name", "100%", "what?", "hash#", "back\\slash", "space ", "café"];
    const plan = planWorkerRouting({ manifest: names.map((name) => route(`/${name}`)) });
    for (const pathname of ["/@user", "/a+b", "/x,y", "/k=v", "/a:b", "/literal%2Aname", "/100%25", "/what%3F", "/hash%23", "/back%5Cslash", "/space%20", "/caf%C3%A9"]) {
      expect(plan.patterns).toContain(pathname);
    }
    expect(() => planWorkerRouting({ manifest: [route(`/${"a".repeat(100)}`)] })).toThrow(/100-character limit/);
  });
});
