/** A build-scoped index of confirmed public snapshots, served by Static Assets. */
export function createStaticNavigation({ buildId, fetch, origin, pageLoaders }) {
  let pending;
  async function readManifest() {
    const response = await fetch(new URL("/_goribu/navigation.json", origin).href, {
      headers: { accept: "application/json" }, redirect: "error", cache: "no-store",
    });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("application/json")) {
      throw invalidManifest();
    }
    const manifest = await response.json();
    if (manifest?.buildId !== buildId || !isRecord(manifest.routes)) throw invalidManifest();
    const routes = new Map();
    for (const [pathname, entry] of Object.entries(manifest.routes)) {
      if (
        !pathname.startsWith("/") || pathname.startsWith("//") ||
        pathname.startsWith("/_goribu/") || pathname.includes("?") || pathname.includes("#") ||
        canonicalStaticPath(pathname) !== pathname ||
        !isRecord(entry) || typeof entry.routeId !== "string" ||
        !Object.hasOwn(pageLoaders, entry.routeId) ||
        typeof entry.asset !== "string" ||
        !new RegExp(`^/_goribu/navigation/${buildId}/[a-f0-9]{64}\\.json$`).test(entry.asset)
      ) throw invalidManifest();
      routes.set(pathname, Object.freeze({ ...entry, pathname }));
    }
    return routes;
  }
  function ready() {
    // A transient prefetch failure must not poison a later click.
    return pending ??= readManifest().catch((error) => {
      pending = undefined;
      throw error;
    });
  }
  return {
    ready,
    async lookup(destination) {
      const routes = await ready();
      return routes.get(canonicalStaticPath(destination.pathname)) ?? null;
    },
  };
}

function canonicalStaticPath(pathname) {
  try {
    const path = pathname.replace(/\/+$/, "") || "/";
    return path.split("/").map((segment) => encodeURIComponent(decodeURIComponent(segment))).join("/");
  } catch {
    return null;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidManifest() {
  return new Error("[Goribu] Static navigation data is missing, invalid, or belongs to another build. Reload the page to load matching browser code and route data; deploy only completed `goribu build` output.");
}
