import { Fragment, createElement as h, useContext } from "react";
import { RenderDataContext } from "./render-context.js";

/** Emit the CSS owned by the audited browser graph at the Document's chosen head location. */
export function Stylesheet() {
  const data = useContext(RenderDataContext);
  if (data?.developmentStylesHref) {
    return h("link", {
      rel: "stylesheet",
      href: data.developmentStylesHref,
      "data-goribu-dev-styles": "",
    });
  }
  const styles = data?.clientAssets?.styles ?? [];

  if (styles.length === 0) return null;
  return h(
    Fragment,
    null,
    ...styles.map((href) =>
      h("link", { key: href, rel: "stylesheet", href }),
    ),
  );
}
