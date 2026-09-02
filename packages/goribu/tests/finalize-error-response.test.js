import { createElement as h } from "react";
import { describe, expect, it, vi } from "vitest";
import { DefaultDocument } from "../src/rendering/document.js";
import { finalizeErrorResponse } from "../src/runtime/finalize-error-response.js";
import { createHttpError } from "../src/runtime/http-error.js";

describe("finalizeErrorResponse", () => {
  it("returns branded client errors directly without logging or rendering _500", async () => {
    const cause = new SyntaxError("private parser detail");
    const error = createHttpError(
      400,
      "[Goribu] Could not parse the request body. Send valid JSON.",
      { cause },
    );
    const Page = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await finalizeErrorResponse({
        error,
        url: "/submit",
        Page,
        Document: DefaultDocument,
      });

      expect(response.status).toBe(400);
      expect(response.headers.get("content-type")).toBe(
        "text/plain; charset=utf-8",
      );
      await expect(response.text()).resolves.toBe(error.message);
      expect(Page).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("logs and renders every unbranded failure even when it carries a status", async () => {
    const failure = Object.assign(new Error("database connection failed"), {
      status: 418,
    });
    let pageProps;
    function Page(props) {
      pageProps = props;
      return h("main", null, `Error ${props.errorId} at ${props.url}`);
    }
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await finalizeErrorResponse({
        error: failure,
        url: "/account",
        Page,
        Document: DefaultDocument,
      });
      const html = await response.text();

      expect(response.status).toBe(500);
      expect(pageProps).toEqual({
        url: "/account",
        errorId: expect.any(String),
      });
      expect(html).toContain(`Error ${pageProps.errorId} at /account`);
      expect(html).not.toContain(failure.message);
      expect(consoleError).toHaveBeenCalledWith(
        `[Goribu] Unhandled error ${pageProps.errorId}:`,
        failure,
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("uses one unconditional non-rendering fallback when _500 rendering fails", async () => {
    const originalFailure = new Error("handler failed");
    const renderFailure = new Error("custom _500 failed");
    const Page = vi.fn(() => {
      throw renderFailure;
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await finalizeErrorResponse({
        error: originalFailure,
        url: "/boom",
        Page,
        Document: DefaultDocument,
      });
      const body = await response.text();
      const firstLog = consoleError.mock.calls.find(
        ([message]) =>
          typeof message === "string" &&
          message.startsWith("[Goribu] Unhandled error "),
      );
      const errorId = firstLog[0].slice(
        "[Goribu] Unhandled error ".length,
        -1,
      );

      expect(response.status).toBe(500);
      expect(response.headers.get("content-type")).toBe(
        "text/plain; charset=utf-8",
      );
      expect(body).toBe(`Internal Server Error\nError ID: ${errorId}`);
      expect(Page).toHaveBeenCalledOnce();
      expect(firstLog[1]).toBe(originalFailure);
      expect(consoleError).toHaveBeenCalledWith(
        `[Goribu] _500 rendering failed for error ${errorId}:`,
        expect.objectContaining({ cause: renderFailure }),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("still returns a response when production logging itself fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("logger unavailable");
    });

    try {
      const response = await finalizeErrorResponse({
        error: new Error("request failed"),
        url: "/boom",
        Page: () => h("main", null, "Safe 500"),
        Document: DefaultDocument,
      });

      expect(response.status).toBe(500);
      await expect(response.text()).resolves.toContain("Safe 500");
    } finally {
      consoleError.mockRestore();
    }
  });
});
