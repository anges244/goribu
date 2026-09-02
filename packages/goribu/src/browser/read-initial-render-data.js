import {
  PROPS_SCRIPT_ID,
  ROUTE_SCRIPT_ID,
} from "../rendering/render-context.js";

const CLIENT_ENTRY_INSTRUCTION =
  'Render <ClientEntry src="..."> once inside your custom Document body without reusing Goribu\'s reserved script IDs.';

/**
 * Read the inert server-rendered data needed by the future browser bootstrap.
 * A missing route script is intentional for error pages and non-hydrated HTML.
 */
export function readInitialRenderData(browserDocument = globalThis.document) {
  if (
    browserDocument === null ||
    (typeof browserDocument !== "object" &&
      typeof browserDocument !== "function") ||
    typeof browserDocument.getElementById !== "function"
  ) {
    throw new TypeError(
      "[Goribu] Cannot read initial render data because the browser document is unavailable. Start the Goribu client runtime in a browser after the Document has loaded.",
    );
  }

  const routeElement = browserDocument.getElementById(ROUTE_SCRIPT_ID);
  if (routeElement === null) return null;

  const route = parseJsonScript(routeElement, ROUTE_SCRIPT_ID, "route");
  if (
    route === null ||
    typeof route !== "object" ||
    Array.isArray(route) ||
    typeof route.id !== "string" ||
    route.id.length === 0
  ) {
    throw new TypeError(
      `[Goribu] Initial route data in #${ROUTE_SCRIPT_ID} must contain a non-empty string id from Goribu's generated route manifest. ${CLIENT_ENTRY_INSTRUCTION}`,
    );
  }

  const propsElement = browserDocument.getElementById(PROPS_SCRIPT_ID);
  if (propsElement === null) {
    throw new Error(
      `[Goribu] Cannot hydrate route ${JSON.stringify(route.id)} because #${PROPS_SCRIPT_ID} is missing. ${CLIENT_ENTRY_INSTRUCTION}`,
    );
  }

  const props = parseJsonScript(propsElement, PROPS_SCRIPT_ID, "props");
  if (props === null || typeof props !== "object" || Array.isArray(props)) {
    throw new TypeError(
      `[Goribu] Initial page props in #${PROPS_SCRIPT_ID} must be a JSON object. Return an object from res.render(props) and keep Goribu's inert props script unchanged.`,
    );
  }

  return Object.freeze({ routeId: route.id, props });
}

function parseJsonScript(element, id, label) {
  if (
    element.tagName !== "SCRIPT" ||
    typeof element.getAttribute !== "function" ||
    element.getAttribute("type") !== "application/json"
  ) {
    throw new TypeError(
      `[Goribu] Cannot read initial ${label} data because #${id} is not an inert <script type="application/json">. ${CLIENT_ENTRY_INSTRUCTION}`,
    );
  }

  try {
    return JSON.parse(element.textContent ?? "");
  } catch (cause) {
    throw new SyntaxError(
      `[Goribu] Cannot parse initial ${label} data from #${id}. ${CLIENT_ENTRY_INSTRUCTION}`,
      { cause },
    );
  }
}
