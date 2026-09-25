import { createElement as h } from "react";
import { describe, expect, it, vi } from "vitest";
import { DefaultDocument } from "../src/rendering/document.js";
import { renderServerError } from "../src/rendering/render-server-error.js";

describe("renderServerError", () => {
  it("streams a custom _500 with status 500 and only safe prepared props", async () => {
    let receivedProps;

    function Page(props) {
      receivedProps = props;
      return h("main", null, `Failure ${props.errorId} at ${props.url}`);
    }
    function Document({ children }) {
      return h("html", null, h("body", null, h("section", { id: "error" }, children)));
    }

    const response = await renderServerError({
      url: "/checkout",
      errorId: "err-a1b2",
      error: new Error("must not reach the page"),
      Page,
      Document,
    });

    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(response.bodyUsed).toBe(false);
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );

    const html = await response.text();
    expect(receivedProps).toEqual({ url: "/checkout", errorId: "err-a1b2" });
    expect(Object.keys(receivedProps).sort()).toEqual(["errorId", "url"]);
    expect(html).toContain(
      '<section id="error"><main>Failure err-a1b2 at /checkout</main></section>',
    );
    expect(html).not.toContain("must not reach the page");
  });

  it("uses a generic built-in page when no custom _500 page is loaded", async () => {
    const response = await renderServerError({
      url: "/boom",
      errorId: "err-default",
      Page: null,
      Document: DefaultDocument,
    });
    const html = await response.text();

    expect(response.status).toBe(500);
    expect(html).toContain('class="ge-status">500</p>');
    expect(html).toContain("Something went wrong.");
    expect(html).toContain("<dt>Error ID</dt><dd><code>err-default</code>");
  });

  it("fails closed for missing safe fields and an invalid supplied page", async () => {
    await expect(renderServerError()).rejects.toThrow(
      "[Goribu] renderServerError({ url, errorId, Page, Document }) requires a prepared safe request location",
    );
    await expect(
      renderServerError({ url: "/boom", errorId: "" }),
    ).rejects.toThrow("requires a non-empty error correlation ID");
    await expect(
      renderServerError({
        url: "/boom",
        errorId: "err-invalid-page",
        Page: {},
        Document: DefaultDocument,
      }),
    ).rejects.toThrow(
      "[Goribu] Cannot render the _500 page because its loaded default export is not a React component",
    );
  });

  it("propagates _500 rendering failures to the final fallback", async () => {
    const failure = new Error("custom _500 failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        renderServerError({
          url: "/boom",
          errorId: "err-render",
          Page() {
            throw failure;
          },
          Document: DefaultDocument,
        }),
      ).rejects.toMatchObject({
        message:
          "[Goribu] Could not start streaming the rendered page. Check the route page and Document components for an error.",
        cause: failure,
      });
    } finally {
      consoleError.mockRestore();
    }
  });
});
