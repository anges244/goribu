import { Fragment, createElement as h, useContext } from "react";
import { RenderDataContext } from "./render-context.js";

/** Emit the CSS owned by the audited browser graph at the Document's chosen head location. */
export function Stylesheet() {
  const styles = useContext(RenderDataContext)?.clientAssets?.styles ?? [];

  if (styles.length === 0) return null;
  return h(
    Fragment,
    null,
    ...styles.map((href) =>
      h("link", { key: href, rel: "stylesheet", href }),
    ),
  );
}
