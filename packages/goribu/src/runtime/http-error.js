const HTTP_ERRORS = new WeakSet();

/**
 * Create a private framework-originated client HTTP error.
 *
 * Only branded 4xx errors may bypass the future _500 path. Keeping construction
 * internal prevents arbitrary application exceptions with a status property from
 * becoming client-visible responses without logging.
 *
 * @param {number} status
 * @param {string} message
 * @param {{ cause?: unknown }} [options]
 * @returns {Error & { readonly status: number }}
 */
export function createHttpError(status, message, options) {
  if (!Number.isInteger(status) || status < 400 || status > 499) {
    throw new RangeError(
      "[Goribu] createHttpError(status, message) requires an integer client-error status from 400 through 499. " +
        "Use the server-error boundary for unexpected failures and 5xx responses.",
    );
  }
  if (typeof message !== "string" || message.length === 0) {
    throw new TypeError(
      "[Goribu] createHttpError(status, message) requires a non-empty safe response message. " +
        "Describe the client input problem without including secrets or internal error details.",
    );
  }

  const hasCause =
    options !== null &&
    typeof options === "object" &&
    Object.hasOwn(options, "cause");
  const error = hasCause
    ? new Error(message, { cause: options.cause })
    : new Error(message);

  Object.defineProperties(error, {
    name: { configurable: true, value: "HttpError" },
    status: { enumerable: true, value: status },
  });
  HTTP_ERRORS.add(error);

  return error;
}

/** Return whether a value is a genuine internal client HTTP error. */
export function isHttpError(value) {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  ) && HTTP_ERRORS.has(value);
}
