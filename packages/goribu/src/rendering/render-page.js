import { createElement as h } from "react";
import { renderToReadableStream } from "react-dom/server.edge";
import {
  RenderDataContext,
  serializePropsForScript,
  serializeRouteForScript,
} from "./render-context.js";
import { createLocatedPage } from "../navigation/location-context.js";
import { resolveClientAssets } from "./resolve-client-assets.js";
import { createRouteHead } from "./route-head.js";

const incompleteRenders = new WeakSet();

/** Recognize renderPage's own complete-render failure without matching text. */
export function isIncompleteRenderError(error) {
  return incompleteRenders.has(error);
}

/**
 * Stream one matched route page into a Worker HTML Response.
 *
 * The page renders inside the application's document shell and its React body
 * starts flowing as soon as the shell is ready, rather than after the whole
 * document is buffered. An implicit-GET page renders with empty props; a handler
 * that returns res.render(props) supplies the props (and any extra response
 * headers), which this module passes to both the page component and an inert JSON
 * channel for browser hydration. Matched pages also carry their canonical route
 * ID so the browser selects the same component from the generated loader map.
 *
 * A complete render is for build-time snapshots. It waits for every Suspense
 * boundary and rejects when React reports an error, because the stream would
 * otherwise finish with a fallback that only client rendering can repair.
 *
 * @param {{ Page: Function, Document: Function, routeId?: string, location?: string, status?: number, props?: object, headers?: object, metadata?: object, nonce?: string, mode?: "development"|"production", clientAssetManifest?: object|null, clientAssetBase?: string, complete?: boolean }} options
 * @returns {Promise<Response>}
 */
export async function renderPage(options) {
  const Page = options?.Page;
  const Document = options?.Document;
  const status = options?.status ?? 200;
  const props = options?.props ?? {};
  const hasMetadata =
    options !== null &&
    typeof options === "object" &&
    Object.hasOwn(options, "metadata");
  const hasRouteId =
    options !== null &&
    typeof options === "object" &&
    Object.hasOwn(options, "routeId");

  if (typeof Page !== "function") {
    throw new TypeError(
      "[Goribu] Cannot render HTML because the matched route has no valid default page component. " +
        "Export a React component as the route's default export.",
    );
  }
  if (typeof Document !== "function") {
    throw new TypeError(
      "[Goribu] Cannot render HTML because Document is not a React component. " +
        "Default-export a component that accepts { children, head, nonce } from src/setup/_document.jsx, or remove _document.jsx to use the default.",
    );
  }

  const renderData = Object.freeze({
    routeJson: hasRouteId ? serializeRouteForScript(options.routeId, {
      ...(options?.uploads === undefined ? {} : { uploads: options.uploads }),
      ...(options?.clientAssetManifest?.navigationBuildId === undefined ? {} : {
        buildId: options.clientAssetManifest.navigationBuildId,
        meta: options.metadata ?? {},
        status,
      }),
    }) : null,
    propsJson: serializePropsForScript(props),
    clientAssets:
      options?.clientAssetManifest === undefined ||
      options?.clientAssetManifest === null
        ? null
        : resolveClientAssets({
            manifest: options.clientAssetManifest,
            routeId: hasRouteId ? options.routeId : null,
            base: options.clientAssetBase,
          }),
    mode: options?.mode,
    developmentClientHref: options?.mode === "development"
      ? `${(options?.clientAssetBase ?? "/").replace(/\/$/, "")}/@vite/client`
      : null,
    developmentStylesHref: options?.mode === "development"
      ? `${(options?.clientAssetBase ?? "/").replace(/\/$/, "")}/_goribu/dev-styles.css${hasRouteId ? `?route=${encodeURIComponent(options.routeId)}` : ""}`
      : null,
    nonce: options?.nonce,
  });
  const tree = h(
    RenderDataContext.Provider,
    { value: renderData },
    h(Document, {
      children: createLocatedPage(Page, props, options?.location, undefined, undefined, undefined, { uploads: options?.uploads, action: options?.location }),
      head: hasMetadata ? createRouteHead(options.metadata) : null,
      nonce: options?.nonce,
    }),
  );

  const reported = [];
  let stream;
  try {
    // Do not await stream.allReady: returning as soon as React has a shell is
    // what preserves streaming behavior on Cloudflare Workers.
    stream = await renderToReadableStream(tree, {
      ...(options?.nonce === undefined ? {} : { nonce: options.nonce }),
      ...(options?.complete === true ? { onError: (error) => { reported.push(error); } } : {}),
    });
  } catch (cause) {
    throw new Error(
      "[Goribu] Could not start streaming the rendered page. " +
        "Check the route page and Document components for an error.",
      { cause },
    );
  }
  if (options?.complete === true) {
    await stream.allReady;
    if (reported.length > 0) {
      const error = new Error(
        "[Goribu] React reported an error inside a Suspense boundary, so the page would ship its fallback and rely on client rendering. " +
          "Fix the component so it renders completely without a request.",
        { cause: reported[0] },
      );
      incompleteRenders.add(error);
      throw error;
    }
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
