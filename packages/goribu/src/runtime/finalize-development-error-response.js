import { isHttpError } from "./http-error.js";

/**
 * Turn one development request failure into an actionable Web Response.
 *
 * Genuine framework 4xx failures keep their deliberately safe message. Every
 * other thrown value is logged and disclosed as plain text for local debugging;
 * custom _500 pages and production correlation IDs do not participate.
 *
 * @param {{ error: unknown, url: string }} options
 * @returns {Response}
 */
export function finalizeDevelopmentErrorResponse(options) {
  const error = options?.error;
  const url = options?.url;

  if (typeof url !== "string" || url.length === 0) {
    throw new TypeError(
      "[Goribu] finalizeDevelopmentErrorResponse({ error, url }) requires the request pathname as a non-empty string. Pass new URL(request.url).pathname from the development request boundary.",
    );
  }

  if (isHttpError(error)) {
    return new Response(error.message, {
      status: error.status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  logError("[Goribu] Development request failed:", error);
  const detail = describeThrownValue(error);
  return new Response(
    `[Goribu] Development request failed while handling ${JSON.stringify(url)}. ` +
      `Fix the reported failure and retry the request.\n\n${detail}`,
    {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    },
  );
}

function describeThrownValue(error) {
  try {
    if (error instanceof Error) {
      if (typeof error.stack === "string" && error.stack.length > 0) {
        return error.stack;
      }

      const name =
        typeof error.name === "string" && error.name.length > 0
          ? error.name
          : "Error";
      const message =
        typeof error.message === "string" && error.message.length > 0
          ? `: ${error.message}`
          : "";
      return `${name}${message}`;
    }

    if (typeof error === "string") return error;

    const serialized = JSON.stringify(error, null, 2);
    if (typeof serialized === "string") return `Thrown value:\n${serialized}`;

    return `Thrown value: ${String(error)}`;
  } catch {
    return "Thrown value could not be formatted.";
  }
}

function logError(message, error) {
  try {
    console.error(message, error);
  } catch {
    // Development disclosure must still reach the response if logging fails.
  }
}
