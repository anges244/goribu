/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { applyDocumentMeta } from "../src/browser/apply-document-meta.js";

describe("applyDocumentMeta", () => {
  it("replaces the complete route-owned head set while preserving Document-owned nodes", () => {
    const browserDocument = document.implementation.createHTMLDocument();
    browserDocument.head.insertAdjacentHTML(
      "beforeend",
      [
        '<meta name="viewport" content="width=device-width">',
        '<title data-goribu-head>Old title</title>',
        '<meta data-goribu-head name="description" content="old">',
        '<link data-goribu-head rel="canonical" href="https://example.com/old">',
      ].join(""),
    );

    applyDocumentMeta(
      {
        title: "Post 42",
        description: "A route description",
        canonical: "https://example.com/posts/42",
        robots: "index,follow",
        meta: [
          { property: "og:title", content: "Post 42" },
          { property: "og:image", content: "/one.png" },
          { property: "og:image", content: "/two.png" },
        ],
        links: [
          {
            rel: "preload",
            href: "/hero.avif",
            as: "image",
            fetchPriority: "high",
            imageSrcSet: "/hero.avif 1x, /hero@2x.avif 2x",
          },
        ],
      },
      browserDocument,
    );

    expect(browserDocument.head.querySelector('meta[name="viewport"]')).not.toBeNull();
    expect(browserDocument.title).toBe("Post 42");
    expect(
      browserDocument.head.querySelector('meta[name="description"]')?.content,
    ).toBe("A route description");
    expect(
      browserDocument.head.querySelector('link[rel="canonical"]')?.href,
    ).toBe("https://example.com/posts/42");
    expect(
      [...browserDocument.head.querySelectorAll('meta[property="og:image"]')].map(
        (element) => element.content,
      ),
    ).toEqual(["/one.png", "/two.png"]);

    const preload = browserDocument.head.querySelector('link[rel="preload"]');
    expect(preload?.getAttribute("fetchpriority")).toBe("high");
    expect(preload?.getAttribute("imagesrcset")).toBe(
      "/hero.avif 1x, /hero@2x.avif 2x",
    );
    expect(
      browserDocument.head.querySelectorAll("[data-goribu-head]"),
    ).toHaveLength(8);
  });

  it("uses a managed empty title when the next route has no title", () => {
    const browserDocument = document.implementation.createHTMLDocument();
    browserDocument.head.insertAdjacentHTML(
      "beforeend",
      '<title data-goribu-head>Stale title</title>',
    );

    applyDocumentMeta({}, browserDocument);

    const title = browserDocument.head.querySelector("title[data-goribu-head]");
    expect(title).not.toBeNull();
    expect(title?.textContent).toBe("");
    expect(browserDocument.title).toBe("");
  });

  it("fails teachingfully when the application Document has no usable head", () => {
    expect(() => applyDocumentMeta({}, {})).toThrowError(
      /\[Goribu\].*complete <html><head>/,
    );
  });
});
