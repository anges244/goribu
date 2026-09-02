import { Fragment, createElement as h } from "react";
import {
  InitialPropsScript,
  InitialRouteScript,
} from "./render-context.js";

/**
 * Emit the complete initial browser boundary at the Document's chosen location:
 * matched route data, page props, then the external module entry.
 *
 * The explicit `src` is the development entry served by Vite. Block 5 substep 5
 * replaces it in production with the build-resolved hashed entry and emits the
 * matched page's module preloads without changing this public component.
 */
export function ClientEntry(props) {
  const src = props?.src;

  if (typeof src !== "string" || src.length === 0) {
    throw new TypeError(
      "[Goribu] <ClientEntry src> requires a non-empty client module URL. Pass the browser entry served by Goribu's Vite development server.",
    );
  }

  return h(
    Fragment,
    null,
    h(InitialRouteScript, { key: "route" }),
    h(InitialPropsScript, { key: "props" }),
    h("script", { key: "entry", type: "module", src }),
  );
}
