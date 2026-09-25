import { renderServerError } from "../rendering/render-server-error.js";
import { resolveRouteMeta } from "../metadata/route-meta.js";
import { isHttpError } from "./http-error.js";

/**
 * Finalize one production request failure into a Web Response.
 *
 * The application boundary supplies an already reviewed/redacted URL and already
 * loaded error-page values. Development disclosure, cookies, final HEAD
 * normalization, dispatch wiring, and global response policy remain outside.
 *
 * @param {{ error: unknown, url: string, retryUrl?: string, cfRay?: string, Page?: Function|null, meta?: unknown, routeId?: string, metadataUrl?: URL|string, Document: Function, nonce?: string, clientAssetManifest?: object|null, clientAssetBase?: string }} options
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
  const cfRay = options?.cfRay;
  const reference = cfRay ? `${errorId} (CF-Ray: ${cfRay})` : errorId;
  logError(`[Goribu] Unhandled error ${reference}:`, error);

  try {
    const props = { url: options?.url, errorId, ...(cfRay ? { cfRay } : {}) };
    const metadataUrl =
      options?.metadataUrl ??
      new URL(options?.url ?? "/", "https://goribu.invalid");
    const metadata = resolveRouteMeta({
      meta: options?.meta,
      props,
      url: metadataUrl,
      routeId: options?.routeId ?? "built-in _500",
    });
    return await renderServerError({
      url: options?.url,
      retryUrl: options?.retryUrl,
      errorId,
      cfRay,
      Page: options?.Page,
      Document: options?.Document,
      metadata,
      nonce: options?.nonce,
      mode: "production",
      clientAssetManifest: options?.clientAssetManifest,
      clientAssetBase: options?.clientAssetBase,
    });
  } catch (renderError) {
    logError(`[Goribu] _500 rendering failed for error ${reference}:`, renderError);
    return new Response(`Internal Server Error\nError ID: ${errorId}${cfRay ? `\nCloudflare Ray ID: ${cfRay}` : ""}`, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
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
