import { createNavigationController } from "./browser/create-navigation-controller.js";
import { hydrateInitialPage } from "./browser/hydrate-initial-page.js";
import { installNavigationRuntime } from "./navigation/navigation-runtime.js";
import { readInitialRenderData } from "./browser/read-initial-render-data.js";

if (typeof document !== "undefined") {
  startClient().catch((error) => {
    console.error("[Goribu] Initial client bootstrap failed.", error);
  });
}

async function startClient() {
  // Kept as a literal so Vite can resolve and split the generated manifest.
  const { pageLoaders, navigationBuildId } = await import("virtual:goribu/client-pages");
  const initial = readInitialRenderData();
  if (initial !== null && navigationBuildId && initial.buildId !== navigationBuildId) {
    window.location.reload();
    return null;
  }
  const root = await hydrateInitialPage({ pageLoaders });
  if (root === null) return null;

  const navigation = createNavigationController({ root, pageLoaders, navigationBuildId });
  installNavigationRuntime(navigation);
  return navigation;
}
