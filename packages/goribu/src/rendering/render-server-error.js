import { createElement as h } from "react";
import { renderPage } from "./render-page.js";

/**
 * Stream an internal 500 response through an already loaded optional _500 page.
 *
 * The application boundary owns the raw error, correlation-ID generation,
 * logging, development disclosure, cookies, URL redaction, and final plain-text
 * fallback. This renderer accepts only public page props so raw error details
 * cannot cross into production HTML.
 *
 * @param {{ url: string, errorId: string, Page?: Function|null, Document: Function, clientAssetManifest?: object|null, clientAssetBase?: string }} options
 * @returns {Promise<Response>}
 */
export async function renderServerError(options) {
  const url = options?.url;
  const errorId = options?.errorId;
  const Page = options?.Page ?? DefaultServerErrorPage;

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
    props: { url, errorId },
    status: 500,
    clientAssetManifest: options?.clientAssetManifest,
    clientAssetBase: options?.clientAssetBase,
  });
}

function DefaultServerErrorPage({ errorId }) {
  return h(
    "main",
    null,
    h("h1", null, "500"),
    h("p", null, "Something went wrong."),
    h("p", null, "Error ID: ", h("code", null, errorId)),
  );
}
