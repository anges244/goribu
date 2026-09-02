import { createElement as h } from "react";
import { ClientEntry } from "./client-entry.js";

const DEV_CLIENT_ENTRY = "/src/client-entry.js";

/**
 * Goribu's default HTML document shell.
 *
 * Goribu owns the html, head, and body structure so every route produces one
 * consistent, valid document. An application intervenes by adding a top-level
 * `src/routes/_document.jsx` that default-exports its own `Document`; that
 * component receives the rendered page as `children` and is responsible for the
 * same three elements. The `root` wrapper is where the client runtime hydrates,
 * and `<ClientEntry>` emits the inert render data and browser module entry after
 * that root.
 *
 * This block passes only `children`. Metadata head content and nonces are added
 * to this contract by the substep that owns them, and an existing `Document`
 * keeps working because it simply ignores props it does not read.
 */
export function DefaultDocument({ children }) {
  return h(
    "html",
    null,
    h("head", null, h("meta", { charSet: "utf-8" })),
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
