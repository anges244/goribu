/**
 * Per-render data channel for browser hydration metadata.
 *
 * Each streamed React tree receives its own context value, so overlapping Worker
 * requests cannot overwrite one another. Document helpers consume the same
 * channel for inert hydration data, graph-owned assets, mode, and the request nonce
 * without importing server-only rendering code.
 */
import {
  createContext,
  createElement as h,
  useContext,
} from "react";

export const PROPS_SCRIPT_ID = "__GORIBU_PROPS__";
export const ROUTE_SCRIPT_ID = "__GORIBU_ROUTE__";

// The context object is shared, but every render provides its own immutable
// value. React keeps provider values scoped to their stream, so concurrent
// Worker requests never communicate through mutable module state.
export const RenderDataContext = createContext(null);

/** Emit the active render's route identity as inert, parseable JSON data. */
export function InitialRouteScript() {
  const renderData = useContext(RenderDataContext);
  if (!renderData?.routeJson) return null;

  return h("script", {
    id: ROUTE_SCRIPT_ID,
    type: "application/json",
    nonce: renderData.nonce,
    dangerouslySetInnerHTML: { __html: renderData.routeJson },
  });
}

/** Emit the active render's props as inert, parseable JSON data. */
export function InitialPropsScript() {
  const renderData = useContext(RenderDataContext);
  if (!renderData) return null;

  return h("script", {
    id: PROPS_SCRIPT_ID,
    type: "application/json",
    nonce: renderData.nonce,
    dangerouslySetInnerHTML: { __html: renderData.propsJson },
  });
}

/** Serialize JSON without allowing data to terminate its script element. */
export function serializePropsForScript(props) {
  let serialized;

  try {
    serialized = JSON.stringify(props);
  } catch (cause) {
    throw new TypeError(
      "[Goribu] Could not serialize page props for HTML rendering. " +
        "Return only JSON-serializable data from res.render(props).",
      { cause },
    );
  }

  if (serialized === undefined) {
    throw new TypeError(
      "[Goribu] Could not serialize page props for HTML rendering. " +
        "Pass a plain object to res.render(props).",
    );
  }

  return escapeJsonForScript(serialized);
}

/** Serialize the stable route ID used to select a generated client page loader. */
export function serializeRouteForScript(routeId, snapshot = undefined) {
  if (typeof routeId !== "string" || routeId.length === 0) {
    throw new TypeError(
      "[Goribu] Could not serialize hydration route data because the matched route has no stable source ID. Pass the unchanged route.id from Goribu's generated manifest.",
    );
  }

  return escapeJsonForScript(JSON.stringify({ id: routeId, ...snapshot }));
}

function escapeJsonForScript(serialized) {
  return serialized.replace(
    /[<>&\u2028\u2029]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
