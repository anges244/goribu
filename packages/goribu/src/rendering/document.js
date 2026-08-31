import { createElement as h } from "react";

/**
 * Goribu's default HTML document shell.
 *
 * Goribu owns the html, head, and body structure so every route produces one
 * consistent, valid document. An application intervenes by adding a top-level
 * `src/routes/_document.jsx` that default-exports its own `Document`; that
 * component receives the rendered page as `children` and is responsible for the
 * same three elements. The `root` wrapper is where Block 5's client runtime will
 * hydrate.
 *
 * This block passes only `children`. Metadata `head` content and the hydration
 * `nonce` are added to this contract by the blocks that own them, and an existing
 * `Document` keeps working because it simply ignores props it does not read.
 */
export function DefaultDocument({ children }) {
  return h(
    "html",
    null,
    h("head", null, h("meta", { charSet: "utf-8" })),
    h("body", null, h("div", { id: "root" }, children)),
  );
}
