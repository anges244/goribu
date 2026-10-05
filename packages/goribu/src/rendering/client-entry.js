import { Fragment, createElement as h, useContext } from "react";
import {
  InitialPropsScript,
  InitialRouteScript,
  RenderDataContext,
} from "./render-context.js";

/**
 * Emit the complete initial browser boundary at the Document's chosen location:
 * matched route data, page props, then the external module entry.
 *
 * When the active render carries build-resolved client assets, Goribu names the
 * hashed production entry and preloads the shared and matched-page chunks.
 * `<Stylesheet />` emits graph-owned CSS separately at the Document's chosen head
 * location. Without resolved assets, `src` remains the development fallback.
 */
export function ClientEntry(props) {
  const renderData = useContext(RenderDataContext);
  if (props?.src === "/src/client-entry.js") {
    throw new TypeError(
      '[Goribu] The browser entry has moved. Set <ClientEntry src="/src/setup/client-entry.js" /> in src/setup/_document and move the entry file to src/setup/client-entry.js, updating its relative imports.',
    );
  }
  const resolved = renderData?.clientAssets ?? null;
  const src = resolved?.src ?? props?.src;
  const nonce = renderData?.nonce ?? props?.nonce;

  if (typeof src !== "string" || src.length === 0) {
    throw new TypeError(
      "[Goribu] <ClientEntry src> requires a non-empty client module URL. Pass the browser entry emitted by Goribu's Vite build.",
    );
  }

  const children = [];
  // Worker-rendered HTML does not pass through Vite's transformIndexHtml.
  // Start its error overlay/HMR connection independently of application imports,
  // which may fail before CSS or import.meta.hot can load the Vite client.
  if (renderData?.developmentClientHref) {
    children.push(h("script", {
      key: "dev-client", type: "module", src: renderData.developmentClientHref, nonce,
    }));
  }
  if (resolved !== null) {
    for (const href of resolved.modulePreloads) {
      children.push(
        h("link", { key: `preload:${href}`, rel: "modulepreload", href }),
      );
    }
  }
  children.push(h(InitialRouteScript, { key: "route" }));
  children.push(h(InitialPropsScript, { key: "props" }));
  children.push(h("script", { key: "entry", type: "module", src, nonce }));

  return h(Fragment, null, ...children);
}
