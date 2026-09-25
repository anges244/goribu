import { createElement as h } from "react";
import { ClientEntry } from "./client-entry.js";
import { Stylesheet } from "./stylesheet.js";

const DEV_CLIENT_ENTRY = "/src/setup/client-entry.js";

/**
 * Goribu's default HTML document shell.
 *
 * Goribu owns the html, head, and body structure so every route produces one
 * consistent, valid document. An application intervenes by adding a top-level
 * `src/setup/_document.jsx` that default-exports its own `Document`; that
 * component receives the rendered page as `children` and is responsible for the
 * same three elements. The `root` wrapper is where the client runtime hydrates,
 * and `<ClientEntry>` emits the inert render data and browser module entry after
 * that root.
 *
 * The route-owned `head` tree contains metadata that the browser navigation
 * runtime can replace independently. `nonce` is shared by the Document and all
 * framework scripts for request-scoped CSP policy.
 */
export function DefaultDocument({ children, head }) {
  return h(
    "html",
    null,
    h("head", null,
      h("meta", { charSet: "utf-8" }),
      h("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
      h(Stylesheet), head,
    ),
    h(
      "body",
      null,
      h("div", { id: "root" }, children),
      // Production render data replaces this development URL with the hashed
      // entry resolved from the emitted client asset manifest.
      h(ClientEntry, { src: DEV_CLIENT_ENTRY }),
    ),
  );
}
