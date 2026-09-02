import { describe, expect, it } from "vitest";
import {
  createHttpError,
  isHttpError,
} from "../src/runtime/http-error.js";

describe("internal HTTP errors", () => {
  it("creates only genuine immutable 4xx errors and rejects lookalikes", () => {
    const cause = new SyntaxError("invalid source");
    const error = createHttpError(
      400,
      "[Goribu] The request body is invalid.",
      { cause },
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("HttpError");
    expect(error.status).toBe(400);
    expect(error.cause).toBe(cause);
    expect(isHttpError(error)).toBe(true);
    expect(
      isHttpError({
        name: "HttpError",
        status: 400,
        message: error.message,
      }),
    ).toBe(false);
    expect(() => {
      error.status = 401;
    }).toThrow(TypeError);

    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("property trap must not run");
        },
      },
    );
    expect(() => isHttpError(hostile)).not.toThrow();
    expect(isHttpError(hostile)).toBe(false);
  });

  it("fails closed for non-client statuses and unsafe messages", () => {
    expect(() => createHttpError(500, "Server failed")).toThrow(
      "[Goribu] createHttpError(status, message) requires an integer client-error status from 400 through 499",
    );
    expect(() => createHttpError(400, "")).toThrow(
      "[Goribu] createHttpError(status, message) requires a non-empty safe response message",
    );
  });
});
