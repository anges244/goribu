import { createElement as h } from "react";
import { renderToReadableStream } from "react-dom/server.edge";

/**
 * Stream one matched route page into a Worker HTML Response.
 *
 * The page renders inside the application's document shell and its React body
 * starts flowing as soon as the shell is ready, rather than after the whole
 * document is buffered. An implicit-GET page renders with empty props; a handler
 * that returns res.render(props) supplies the props (and any extra response
 * headers), which this module passes straight to the page component and the Web
 * Response. Serializing those props into the page for browser hydration is the
 * client runtime's job in a later block.
 *
 * @param {{ Page: Function, Document: Function, status?: number, props?: object, headers?: object }} options
 * @returns {Promise<Response>}
 */
export async function renderPage(options) {
  const Page = options?.Page;
  const Document = options?.Document;
  const status = options?.status ?? 200;
  const props = options?.props ?? {};

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

  const tree = h(Document, { children: h(Page, props) });

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
    headers: buildHeaders(options?.headers),
  });
}

/**
 * Build the response headers for a rendered page: any headers a handler chained
 * before res.render(props), plus a text/html default only when the handler set no
 * content-type of its own. Applying the handler headers first means a handler
 * value overrides the default, so a route can send its own content-type; array
 * values append so repeated headers survive.
 */
function buildHeaders(values) {
  const headers = new Headers();

  for (const [name, value] of Object.entries(values ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }

  if (!headers.has("content-type")) {
    headers.set("content-type", "text/html; charset=utf-8");
  }

  return headers;
}
