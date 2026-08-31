import { createElement as h } from "react";
import { renderToReadableStream } from "react-dom/server.edge";

/**
 * Stream one matched route page into a Worker HTML Response.
 *
 * The page renders inside the application's document shell and its React body
 * starts flowing as soon as the shell is ready, rather than after the whole
 * document is buffered. This block renders pages with empty props: route params
 * and loaded data reach a page only through a request handler, which arrives in
 * a later block, so an implicit-GET page has nothing to receive yet.
 *
 * @param {{ Page: Function, Document: Function, status?: number }} options
 * @returns {Promise<Response>}
 */
export async function renderPage(options) {
  const Page = options?.Page;
  const Document = options?.Document;
  const status = options?.status ?? 200;

  if (typeof Page !== "function") {
    throw new TypeError(
      "[Goribu] Cannot render HTML because the matched route has no valid default page component. " +
        "Export a React component as the route's default export.",
    );
  }
  if (typeof Document !== "function") {
    throw new TypeError(
      "[Goribu] Cannot render HTML because Document is not a React component. " +
        "Default-export a component that accepts { children } from src/routes/_document.jsx, or remove _document.jsx to use the default.",
    );
  }

  const tree = h(Document, { children: h(Page, {}) });

  let stream;
  try {
    // Do not await stream.allReady: returning as soon as React has a shell is
    // what preserves streaming behavior on Cloudflare Workers.
    stream = await renderToReadableStream(tree);
  } catch (cause) {
    throw new Error(
      "[Goribu] Could not start streaming the rendered page. " +
        "Check the route page and Document components for an error.",
      { cause },
    );
  }

  return new Response(stream, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
