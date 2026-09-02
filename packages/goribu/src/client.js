import { createNavigationController } from "./browser/create-navigation-controller.js";
import { hydrateInitialPage } from "./browser/hydrate-initial-page.js";
import { installNavigationRuntime } from "./navigation/navigation-runtime.js";

if (typeof document !== "undefined") {
  startClient().catch((error) => {
    console.error("[Goribu] Initial client bootstrap failed.", error);
  });
}

async function startClient() {
  // Kept as a literal so Vite can resolve and split the generated manifest.
  const { pageLoaders } = await import("virtual:goribu/client-pages");
  const root = await hydrateInitialPage({ pageLoaders });
  if (root === null) return null;

  const navigation = createNavigationController({ root, pageLoaders });
  installNavigationRuntime(navigation);
  return navigation;
}
