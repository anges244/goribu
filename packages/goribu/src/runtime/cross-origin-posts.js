// Browsers send these POSTs to another origin without a CORS preflight, carrying
// the user's cookies. Every other cross-origin mutation is preflighted, so the
// application's CORS answer already decides whether the browser sends it.
const PREFLIGHT_FREE_TYPES = new Set([
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
]);

const OPT_OUT = "allowCrossOriginForms";

/**
 * Validate every route's cross-origin opt-out once, when the Worker is created,
 * and return the IDs of routes that accept cross-origin form posts.
 */
export function collectCrossOriginFormRoutes(manifest, modules) {
  const routes = new Set();
  for (const route of manifest) {
    const module = modules.get(route.id);
    if (!module || !Object.hasOwn(module, OPT_OUT)) continue;
    const source = `[Goribu] Route ${JSON.stringify(route.id)} exports ${OPT_OUT}`;
    const value = module[OPT_OUT];
    if (value !== true) {
      throw new TypeError(
        `${source} as ${typeof value === "string" ? JSON.stringify(value) : String(value)}. Export \`${OPT_OUT} = true\` to accept cross-origin form posts, or remove the export.`,
      );
    }
    if (!route.methods.includes("POST") || typeof module.POST !== "function") {
      throw new TypeError(
        `${source} but has no POST handler, so the export has no effect. Move it to the route that receives the cross-origin POST.`,
      );
    }
    routes.add(route.id);
  }
  return routes;
}

/**
 * Return whether a browser sent this POST from another origin without a
 * preflight. `Sec-Fetch-Site` decides when present; `Origin` covers browsers
 * that omit it outside secure contexts. Non-browser clients send neither.
 */
export function isPreflightFreeCrossOriginPost(request) {
  if (request.method !== "POST") return false;

  const contentType = request.headers.get("content-type");
  if (contentType !== null) {
    const essence = contentType.split(";", 1)[0].trim().toLowerCase();
    if (essence !== "" && !PREFLIGHT_FREE_TYPES.has(essence)) return false;
  }

  const site = request.headers.get("sec-fetch-site");
  if (site !== null) return site !== "same-origin" && site !== "none";
  const origin = request.headers.get("origin");
  return origin !== null && origin !== new URL(request.url).origin;
}

/** The refusal names the route pattern, never the request-controlled path. */
export function createCrossOriginPostRejection(route) {
  return new Response(
    `[Goribu] Refused a cross-origin POST to ${route.pattern}. Browsers send form posts from other sites with the user's cookies, so Goribu rejects them to prevent cross-site request forgery. ` +
      `Submit from this app's own pages. If this route must receive posts from another site, such as an OAuth form_post or SAML callback, add \`export const ${OPT_OUT} = true\` to its route file and verify each request in the handler.`,
    { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}
