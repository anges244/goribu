const CALLER = "loadClientPage({ routeId, pageLoaders })";

/** Resolve one canonical route ID through the generated client page map. */
export async function loadClientPage(options) {
  const routeId = options?.routeId;
  const pageLoaders = options?.pageLoaders;

  if (typeof routeId !== "string" || routeId.length === 0) {
    throw new TypeError(
      `[Goribu] ${CALLER} requires a non-empty canonical route ID. Use the ID from Goribu's initial render data or navigation envelope without deriving it from the URL.`,
    );
  }
  if (
    pageLoaders === null ||
    typeof pageLoaders !== "object" ||
    Array.isArray(pageLoaders)
  ) {
    throw new TypeError(
      `[Goribu] ${CALLER} requires the pageLoaders object generated from the current route manifest. Pass the generated client page manifest without changing its shape.`,
    );
  }
  if (!Object.hasOwn(pageLoaders, routeId)) {
    throw new Error(
      `[Goribu] Cannot load client page for route ${JSON.stringify(routeId)} because the generated page manifest has no matching loader. Regenerate and rebuild the Worker and client outputs together so their route IDs agree.`,
    );
  }

  const loader = pageLoaders[routeId];
  if (typeof loader !== "function") {
    throw new TypeError(
      `[Goribu] Client page loader for route ${JSON.stringify(routeId)} is not a function. Regenerate the client page manifest from Goribu's current route manifest instead of editing it manually.`,
    );
  }

  let pageModule;
  try {
    pageModule = await loader();
  } catch (cause) {
    throw new Error(
      `[Goribu] Could not load the client page module for route ${JSON.stringify(routeId)}. Check that the current client build emitted and can serve every generated page chunk.`,
      { cause },
    );
  }

  const Page = pageModule?.default;
  if (typeof Page !== "function") {
    throw new TypeError(
      `[Goribu] Loaded client page for route ${JSON.stringify(routeId)} has no valid default React component. Export the route's page component as default and rebuild the client bundle.`,
    );
  }

  return Page;
}
