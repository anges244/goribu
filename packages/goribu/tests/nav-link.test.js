import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { NavLink, isNavLinkActive } from "../src/navigation/nav-link.js";
import { renderPage } from "../src/rendering/render-page.js";

describe("NavLink", () => {
  it.each([
    ["https://example.com/posts", "/posts", false, true],
    ["https://example.com/posts/42?view=full", "/posts", false, true],
    ["https://example.com/posts/42", "/posts", true, false],
    ["https://example.com/posts/", "/posts", true, true],
    ["https://example.com/postscript", "/posts", false, false],
    ["https://example.com/anything", "/", false, false],
    ["https://example.com/", "/", false, true],
    ["https://example.com/posts", "https://other.example/posts", false, false],
  ])(
    "matches %s against %s with end=%s",
    (currentLocation, href, end, expected) => {
      expect(isNavLinkActive({ currentLocation, href, end })).toBe(expected);
    },
  );

  it("renders SSR active state from the request location without leaking control props", async () => {
    function Page() {
      return h(
        "nav",
        null,
        h(
          NavLink,
          {
            href: "/posts",
            className: ({ isActive }) => (isActive ? "active" : "inactive"),
            replace: true,
            prefetch: false,
          },
          "Posts",
        ),
        h(NavLink, { href: "/about", end: true }, "About"),
      );
    }

    function Document({ children }) {
      return h("html", null, h("head"), h("body", null, h("div", { id: "root" }, children)));
    }

    const response = await renderPage({
      Page,
      Document,
      routeId: "src/routes/posts/[id].jsx",
      location: "https://example.com/posts/42?view=full",
    });
    const html = await response.text();

    expect(html).toContain(
      '<a href="/posts" class="active" aria-current="page">Posts</a>',
    );
    expect(html).toContain('<a href="/about">About</a>');
    expect(html).not.toContain("prefetch=");
    expect(html).not.toContain("replace=");
  });
});
