import { createElement as h } from "react";
import { renderPage } from "./render-page.js";
import { DefaultErrorPage } from "./default-error-page.js";

/**
 * Stream the not-found response for a request that matched no route.
 *
 * The application may supply a `_404` page at the top level of its routes
 * directory; otherwise Goribu streams a self-styled built-in page. Both render
 * through the application Document with status 404. A custom page receives empty
 * props on a route miss, or the handler’s res.notFound(props). The built-in page
 * uses only safe request diagnostics; handler headers are preserved.
 *
 * @param {{ NotFoundPage?: Function|null, Document: Function, location?: string, cfRay?: string, props?: object, headers?: object, metadata?: object, nonce?: string, mode?: "development"|"production", clientAssetManifest?: object|null, clientAssetBase?: string }} options
 * @returns {Promise<Response>}
 */
export async function renderNotFound(options) {
  const NotFoundPage = options?.NotFoundPage ?? DefaultNotFoundPage;
  const builtIn = options?.NotFoundPage == null;

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
    props: builtIn
      ? {
          url: options?.location
            ? new URL(options.location, "https://goribu.invalid").pathname
            : undefined,
          cfRay: options?.cfRay,
        }
      : (options?.props ?? {}),
    headers:
      builtIn && options?.cfRay
        ? { ...options?.headers, "cache-control": "no-store" }
        : options?.headers,
    ...(builtIn
      ? {
          metadata: {
            title: "Page not found",
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

function DefaultNotFoundPage(props) {
  return h(DefaultErrorPage, { ...props, status: 404 });
}
