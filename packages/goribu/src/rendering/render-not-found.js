import { createElement as h } from "react";
import { renderPage } from "./render-page.js";

/**
 * Stream the not-found response for a request that matched no route.
 *
 * The application may supply a `_404` page at the top level of its routes
 * directory; when it does not, Goribu streams a plain built-in page. Either way
 * the page renders through the same document shell as any other page, and the
 * response carries a 404 status. A route miss renders with empty props; a handler
 * that returns res.notFound(props) supplies the props (and any extra headers) for
 * the same _404 page.
 *
 * @param {{ NotFoundPage?: Function|null, Document: Function, location?: string, props?: object, headers?: object }} options
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
    location: options?.location,
    status: 404,
    props: options?.props ?? {},
    headers: options?.headers,
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
