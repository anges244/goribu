import { hydrateInitialPage } from "./browser/hydrate-initial-page.js";

if (typeof document !== "undefined") {
  startClient().catch((error) => {
    console.error("[Goribu] Initial client bootstrap failed.", error);
  });
}

async function startClient() {
  // Kept as a literal so Vite can resolve and split the generated manifest.
  const { pageLoaders } = await import("virtual:goribu/client-pages");
  return hydrateInitialPage({ pageLoaders });
}
