import { describe, expect, it } from "vitest";
import {
  EMPTY_ROUTE_META,
  normalizeRouteMeta,
  resolveRouteMeta,
} from "../src/metadata/route-meta.js";

const ROUTE_ID = "src/routes/articles/[slug].jsx";
const SOURCE = `Route metadata for ${JSON.stringify(ROUTE_ID)}`;

describe("route metadata", () => {
  it("uses one frozen normalized value when metadata is absent", () => {
    expect(normalizeRouteMeta(undefined, { source: SOURCE })).toBe(
      EMPTY_ROUTE_META,
    );
    expect(
      resolveRouteMeta({
        meta: undefined,
        props: {},
        url: "https://example.com/articles/one",
        routeId: ROUTE_ID,
      }),
    ).toBe(EMPTY_ROUTE_META);
    expect(EMPTY_ROUTE_META).toEqual({});
    expect(Object.isFrozen(EMPTY_ROUTE_META)).toBe(true);
  });

  it("resolves custom and repeated metadata with exact props and a fresh URL", () => {
    const props = { article: { title: "Route metadata" } };
    const inputUrl = new URL(
      "https://example.com/articles/route-metadata?language=en",
    );
    let received;

    const metadata = resolveRouteMeta({
      meta(context) {
        received = context;
        return {
          title: context.props.article.title,
          description: "A strict metadata contract.",
          canonical: context.url.href,
          robots: "index,follow",
          meta: [
            { property: "og:type", content: "article" },
            { property: "OG:image", content: "/images/cover.webp" },
            { property: "og:image", content: "/images/cover-dark.webp" },
            { name: "theme-color", content: "black" },
            { name: "theme-color", content: "white" },
          ],
          links: [
            {
              rel: "alternate",
              href: "/articles/route-metadata?language=fr",
              hrefLang: "fr",
              type: "text/html",
            },
            {
              rel: "preload",
              href: "/images/cover.webp",
              as: "image",
              fetchPriority: "high",
              imageSrcSet: "/images/cover.webp 1x",
              imageSizes: "100vw",
            },
          ],
        };
      },
      props,
      url: inputUrl,
      routeId: ROUTE_ID,
    });

    expect(received.props).toBe(props);
    expect(received.url).toBeInstanceOf(URL);
    expect(received.url).not.toBe(inputUrl);
    expect(received.url.href).toBe(inputUrl.href);
    expect(metadata).toEqual({
      title: "Route metadata",
      description: "A strict metadata contract.",
      canonical:
        "https://example.com/articles/route-metadata?language=en",
      robots: "index,follow",
      meta: [
        { property: "og:type", content: "article" },
        { property: "OG:image", content: "/images/cover.webp" },
        { property: "og:image", content: "/images/cover-dark.webp" },
        { name: "theme-color", content: "black" },
        { name: "theme-color", content: "white" },
      ],
      links: [
        {
          rel: "alternate",
          href: "/articles/route-metadata?language=fr",
          type: "text/html",
          hrefLang: "fr",
        },
        {
          rel: "preload",
          href: "/images/cover.webp",
          as: "image",
          fetchPriority: "high",
          imageSrcSet: "/images/cover.webp 1x",
          imageSizes: "100vw",
        },
      ],
    });
    expectDeeplyFrozen(metadata);
  });

  it.each([
    [
      { meta: [{ name: "DESCRIPTION", content: "Alternate" }] },
      "description",
    ],
    [{ meta: [{ name: "Robots", content: "noindex" }] }, "robots"],
    [
      {
        links: [
          {
            rel: "alternate CANONICAL",
            href: "https://example.com/articles/one",
          },
        ],
      },
      "canonical",
    ],
  ])("rejects an alternate case-insensitive %s representation", (value, field) => {
    expect(() => normalizeRouteMeta(value, { source: SOURCE })).toThrow(
      new RegExp(
        `^\\[Goribu\\].*${field} has one canonical representation.*top-level ${field}.*remove`,
        "s",
      ),
    );
  });

  it.each([
    [{ viewport: "width=device-width" }, /unknown top-level key "viewport"/],
    [{ onLoad: "alert(1)" }, /unsafe event-like key "onLoad"/],
    [
      { meta: [{ property: "og:title", content: "Title", httpEquiv: "x" }] },
      /unknown descriptor key "httpEquiv"/,
    ],
    [
      { meta: [{ name: "description", property: "og:description", content: "x" }] },
      /exactly \{ name, content \} or \{ property, content \}/,
    ],
    [
      { links: [{ rel: "preload", href: "/app.js", onError: "retry()" }] },
      /unsafe event-like key "onError"/,
    ],
    [
      { links: [{ rel: "preload", href: "/app.js", integrity: "hash" }] },
      /unknown link descriptor key "integrity"/,
    ],
    [{ title: 42 }, /\.title must be a string/],
    [
      { meta: [{ property: "og:title", content: false }] },
      /\.meta\[0\]\.content must be a string/,
    ],
    [{ links: [{ rel: "stylesheet" }] }, /requires both rel and href/],
  ])("rejects unknown, unsafe, or malformed metadata %#", (value, message) => {
    expect(() => normalizeRouteMeta(value, { source: SOURCE })).toThrow(
      /^\[Goribu\]/,
    );
    expect(() => normalizeRouteMeta(value, { source: SOURCE })).toThrow(message);
  });

  it("rejects promises and custom thenables with a synchronous repair instruction", () => {
    expect(() =>
      resolveRouteMeta({
        meta: async () => ({ title: "Too late" }),
        props: {},
        url: "https://example.com/articles/one",
        routeId: ROUTE_ID,
      }),
    ).toThrow(/^\[Goribu\].*synchronously.*cannot be a Promise or thenable/s);

    expect(() =>
      normalizeRouteMeta(
        {
          then() {},
        },
        { source: SOURCE },
      ),
    ).toThrow(/^\[Goribu\].*synchronously.*instead of using async work/s);
  });

  it("wraps metadata function failures with route identity and cause", () => {
    const cause = new Error("database unavailable");
    let thrown;

    try {
      resolveRouteMeta({
        meta() {
          throw cause;
        },
        props: {},
        url: "https://example.com/articles/one",
        routeId: ROUTE_ID,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toMatch(/^\[Goribu\]/);
    expect(thrown.message).toContain(JSON.stringify(ROUTE_ID));
    expect(thrown.message).toContain("returns a metadata object synchronously");
    expect(thrown.cause).toBe(cause);
  });

  it("validates props and URL inputs with teaching errors before resolution", () => {
    expect(() =>
      resolveRouteMeta({
        meta: {},
        props: [],
        url: "https://example.com/articles/one",
        routeId: ROUTE_ID,
      }),
    ).toThrow(/^\[Goribu\].*props is not a plain object.*exact props object/s);

    expect(() =>
      resolveRouteMeta({
        meta: {},
        props: {},
        url: "/relative-only",
        routeId: ROUTE_ID,
      }),
    ).toThrow(/^\[Goribu\].*url is invalid.*absolute URL string/s);
  });
});

function expectDeeplyFrozen(value) {
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === "object") {
      expectDeeplyFrozen(nested);
    }
  }
}
