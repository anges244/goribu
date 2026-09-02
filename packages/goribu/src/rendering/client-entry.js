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
 * Without resolved assets, `src` remains the development fallback.
 */
export function ClientEntry(props) {
  const renderData = useContext(RenderDataContext);
  const resolved = renderData?.clientAssets ?? null;
  const src = resolved?.src ?? props?.src;

  if (typeof src !== "string" || src.length === 0) {
    throw new TypeError(
      "[Goribu] <ClientEntry src> requires a non-empty client module URL. Pass the browser entry emitted by Goribu's Vite build.",
    );
  }

  const children = [];
  if (resolved !== null) {
    for (const href of resolved.modulePreloads) {
      children.push(
        h("link", { key: `preload:${href}`, rel: "modulepreload", href }),
      );
    }
  }
  children.push(h(InitialRouteScript, { key: "route" }));
  children.push(h(InitialPropsScript, { key: "props" }));
  children.push(h("script", { key: "entry", type: "module", src }));

  return h(Fragment, null, ...children);
}
