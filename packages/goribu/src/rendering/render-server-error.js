import { createElement as h } from "react";
import { renderPage } from "./render-page.js";
import { DefaultErrorPage } from "./default-error-page.js";

/**
 * Stream an internal 500 response through an already loaded optional _500 page.
 *
 * The application boundary owns the raw error, correlation-ID generation,
 * logging, development disclosure, cookies, URL redaction, and final plain-text
 * fallback. Only safe diagnostics reach public page props. The built-in retry
 * link separately uses the full request URL without exposing it to custom pages
 * or the serialized props channel.
 *
 * @param {{ url: string, errorId: string, retryUrl?: string, cfRay?: string, Page?: Function|null, Document: Function, metadata?: object, nonce?: string, mode?: "production", clientAssetManifest?: object|null, clientAssetBase?: string }} options
 * @returns {Promise<Response>}
 */
export async function renderServerError(options) {
  const url = options?.url;
  const errorId = options?.errorId;
  const Page = options?.Page ?? ((props) =>
    h(DefaultErrorPage, {
      ...props,
      status: 500,
      retryUrl: options?.retryUrl,
    }));

  if (typeof url !== "string" || url.length === 0) {
    throw new TypeError(
      "[Goribu] renderServerError({ url, errorId, Page, Document }) requires a prepared safe request location as a non-empty string. " +
        'Pass the reviewed or query-redacted value from the application error boundary, such as "/checkout".',
    );
  }
  if (typeof errorId !== "string" || errorId.length === 0) {
    throw new TypeError(
      "[Goribu] renderServerError({ url, errorId, Page, Document }) requires a non-empty error correlation ID. " +
        "Generate and log the ID in the application error boundary before rendering _500.",
    );
  }
  if (typeof Page !== "function") {
    throw new TypeError(
      "[Goribu] Cannot render the _500 page because its loaded default export is not a React component. " +
        "Export a React component as the default export from the application's _500 route.",
    );
  }

  return renderPage({
    Page,
    Document: options?.Document,
    props: {
      url,
      errorId,
      ...(options?.cfRay ? { cfRay: options.cfRay } : {}),
    },
    status: 500,
    headers: { "cache-control": "no-store" },
    ...(options?.Page == null
      ? {
          metadata: {
            title: "Something went wrong",
            robots: "noindex",
            ...options?.metadata,
          },
        }
      : Object.hasOwn(options ?? {}, "metadata")
        ? { metadata: options.metadata }
        : {}),
    nonce: options?.nonce,
    mode: options?.mode,
    clientAssetManifest: options?.clientAssetManifest,
    clientAssetBase: options?.clientAssetBase,
  });
}
