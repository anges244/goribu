import { createElement as h } from "react";
import { renderPage } from "./render-page.js";

/**
 * Stream the not-found response for a request that matched no route.
 *
 * The application may supply a `_404` page at the top level of its routes
 * directory; when it does not, Goribu streams a plain built-in page. Either way
 * the page renders through the same document shell and the same empty-props rule
 * as any other page, and the response carries a 404 status.
 *
 * @param {{ NotFoundPage?: Function|null, Document: Function }} options
 * @returns {Promise<Response>}
 */
export async function renderNotFound(options) {
  const NotFoundPage = options?.NotFoundPage ?? DefaultNotFoundPage;

  if (typeof NotFoundPage !== "function") {
    throw new TypeError(
      "[Goribu] Cannot render the _404 page because its default export is not a React component. " +
        "Export a React component as the default export from the application's _404 route.",
    );
  }

  return renderPage({
    Page: NotFoundPage,
    Document: options?.Document,
    status: 404,
  });
}

function DefaultNotFoundPage() {
  return h(
    "main",
    null,
    h("h1", null, "404"),
    h("p", null, "This page could not be found."),
  );
}
