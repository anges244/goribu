import { describe, expect, it, vi } from "vitest";
import { finalizeDevelopmentErrorResponse } from "../src/runtime/finalize-development-error-response.js";
import { createHttpError } from "../src/runtime/http-error.js";

describe("finalizeDevelopmentErrorResponse", () => {
  it("preserves genuine client-visible framework errors without logging private details", async () => {
    const cause = new SyntaxError("private parser detail");
    const error = createHttpError(
      400,
      "[Goribu] Could not parse the request body. Send valid JSON.",
      { cause },
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = finalizeDevelopmentErrorResponse({
        error,
        url: "/submit",
      });

      expect(response.status).toBe(400);
      expect(response.headers.get("content-type")).toBe(
        "text/plain; charset=utf-8",
      );
      await expect(response.text()).resolves.toBe(error.message);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("discloses a non-Error value thrown by application code", async () => {
    const thrownValue = "route rejected the request";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = finalizeDevelopmentErrorResponse({
        error: thrownValue,
        url: "/account",
      });

      expect(response.status).toBe(500);
      await expect(response.text()).resolves.toContain(thrownValue);
      expect(consoleError).toHaveBeenCalledWith(
        "[Goribu] Development request failed:",
        thrownValue,
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it("logs and discloses an unexpected failure with its request pathname", async () => {
    const error = new Error("database unavailable");
    error.stack = "Error: database unavailable\n    at GET (/app/routes/account.js:3:5)";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = finalizeDevelopmentErrorResponse({
        error,
        url: "/account",
      });
      const body = await response.text();

      expect(response.status).toBe(500);
      expect(response.headers.get("content-type")).toBe(
        "text/plain; charset=utf-8",
      );
      expect(body).toContain(
        "[Goribu] Development request failed while handling \"/account\"",
      );
      expect(body).toContain(error.stack);
      expect(consoleError).toHaveBeenCalledWith(
        "[Goribu] Development request failed:",
        error,
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
