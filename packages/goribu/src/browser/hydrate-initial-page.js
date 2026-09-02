import { hydrateRoot } from "react-dom/client";
import { loadClientPage } from "./load-client-page.js";
import { readInitialRenderData } from "./read-initial-render-data.js";
import { createLocatedPage } from "../navigation/location-context.js";

const ROOT_ELEMENT_ID = "root";

/** Hydrate one matched server-rendered page before navigation is installed. */
export async function hydrateInitialPage(options) {
  const browserDocument =
    options !== null &&
    typeof options === "object" &&
    Object.hasOwn(options, "browserDocument")
      ? options.browserDocument
      : globalThis.document;
  const hydrate = options?.hydrate ?? hydrateRoot;
  const location =
    typeof options?.location === "string"
      ? options.location
      : globalThis.location?.href ?? null;
  const initialData = readInitialRenderData(browserDocument);
  if (initialData === null) return null;

  const rootElement = browserDocument.getElementById(ROOT_ELEMENT_ID);
  if (
    rootElement === null ||
    typeof rootElement !== "object" ||
    rootElement.nodeType !== 1
  ) {
    throw new Error(
      `[Goribu] Cannot hydrate route ${JSON.stringify(initialData.routeId)} because the Document has no valid #${ROOT_ELEMENT_ID} element. Render the matched page inside <div id="${ROOT_ELEMENT_ID}">{children}</div>.`,
    );
  }
  if (typeof hydrate !== "function") {
    throw new TypeError(
      "[Goribu] hydrateInitialPage() requires a hydration function. Use Goribu's browser runtime with react-dom/client available.",
    );
  }

  const Page = await loadClientPage({
    routeId: initialData.routeId,
    pageLoaders: options?.pageLoaders,
  });

  try {
    return hydrate(
      rootElement,
      createLocatedPage(Page, initialData.props, location),
    );
  } catch (cause) {
    throw new Error(
      `[Goribu] Could not hydrate the initial page for route ${JSON.stringify(initialData.routeId)}. Ensure the server and client render the same page component with the same props.`,
      { cause },
    );
  }
}
