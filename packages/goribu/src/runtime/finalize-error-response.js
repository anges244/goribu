import { renderServerError } from "../rendering/render-server-error.js";
import { isHttpError } from "./http-error.js";

/**
 * Finalize one production request failure into a Web Response.
 *
 * The application boundary supplies an already reviewed/redacted URL and already
 * loaded error-page values. Development disclosure, cookies, final HEAD
 * normalization, dispatch wiring, and global response policy remain outside.
 *
 * @param {{ error: unknown, url: string, Page?: Function|null, Document: Function, clientAssetManifest?: object|null, clientAssetBase?: string }} options
 * @returns {Promise<Response>}
 */
export async function finalizeErrorResponse(options) {
  const error = options?.error;

  if (isHttpError(error)) {
    return new Response(error.message, {
      status: error.status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const errorId = createErrorId();
  logError(`[Goribu] Unhandled error ${errorId}:`, error);

  try {
    return await renderServerError({
      url: options?.url,
      errorId,
      Page: options?.Page,
      Document: options?.Document,
      clientAssetManifest: options?.clientAssetManifest,
      clientAssetBase: options?.clientAssetBase,
    });
  } catch (renderError) {
    logError(`[Goribu] _500 rendering failed for error ${errorId}:`, renderError);
    return new Response(`Internal Server Error\nError ID: ${errorId}`, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

function createErrorId() {
  try {
    const randomUUID = globalThis.crypto?.randomUUID;
    if (typeof randomUUID === "function") {
      const id = randomUUID.call(globalThis.crypto);
      if (typeof id === "string" && id.length > 0) return id;
    }
  } catch {
    // Error handling must continue to a response even if correlation-ID generation fails.
  }

  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 12) || "unknown";
  return `${time}-${random}`;
}

function logError(message, error) {
  try {
    console.error(message, error);
  } catch {
    // Logging is best-effort; it must not replace the response with another failure.
  }
}
