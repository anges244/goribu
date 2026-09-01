/**
 * Decide which routes become build-time static output and which prerender
 * candidates must fall back to the Worker.
 *
 * Static output is not a separate feature: it is what the build does when a
 * route's first response needs no Worker. A route qualifies when it is a
 * prerender candidate — an implicit-GET page, or one that set
 * `export const prerender = true` — AND every URL segment is static, so its one
 * URL is known at build time.
 *
 * A candidate with a dynamic segment has no enumerable URL, so it is downgraded
 * to Worker rendering and the caller announces the reason out loud. When such a
 * route explicitly forced prerendering, the mismatch is the author's mistake and
 * fails the build rather than being downgraded silently.
 *
 * @param {Array<{
 *   id: string,
 *   pattern: string,
 *   segments: Array<{ type: "static", value: string } | { type: "dynamic", name: string }>,
 *   prerenderEligible: boolean,
 *   prerenderOverride: boolean | null,
 * }>} manifest
 * @returns {{
 *   staticRoutes: Array<{ id: string, pattern: string, pathname: string, assetPath: string, forced: boolean }>,
 *   downgraded: Array<{ id: string, pattern: string, reason: string }>,
 * }}
 */
export function planStaticRoutes(manifest) {
  const staticRoutes = [];
  const downgraded = [];

  for (const route of manifest) {
    if (!route.prerenderEligible) continue;

    const dynamic = route.segments.filter((segment) => segment.type === "dynamic");
    if (dynamic.length === 0) {
      staticRoutes.push({
        id: route.id,
        pattern: route.pattern,
        pathname: requestPathnameForRoute(route),
        assetPath: assetPathForRoute(route),
        // An author-forced `prerender = true` must build or fail the build; an
        // automatic candidate that can't render is downgraded to the Worker.
        forced: route.prerenderOverride === true,
      });
      continue;
    }

    const names = dynamic.map((segment) => `:${segment.name}`).join(", ");
    const reason =
      `it has ${dynamic.length === 1 ? "a dynamic segment" : "dynamic segments"} ` +
      `(${names}) whose URL is not known at build time`;

    // An explicit `prerender = true` on a route that cannot be static is a
    // contradiction the author asked for. Fail loudly instead of quietly serving
    // it from the Worker, which is the opposite of what they wrote.
    if (route.prerenderOverride === true) {
      throw new Error(
        `[Goribu] Route "${route.id}" (${route.pattern}) sets \`export const prerender = true\`, ` +
          `but ${reason}. Remove the prerender export so the route renders on the Worker, ` +
          `or give the route a fully static URL.`,
      );
    }

    downgraded.push({ id: route.id, pattern: route.pattern, reason });
  }

  return { staticRoutes, downgraded };
}

/**
 * Map a fully static route to the asset file that serves it.
 *
 * The root route becomes `index.html`; every other route becomes
 * `<segments>.html` (for example `/about` -> `about.html`,
 * `/blog/post` -> `blog/post.html`). Cloudflare Static Assets, configured with
 * `html_handling: "drop-trailing-slash"`, serves each of these files at its
 * clean URL, so the file layout and the Worker's canonical URLs agree.
 */
export function assetPathForRoute(route) {
  const segments = route.segments.map((segment) => {
    if (segment.type !== "static") {
      throw new TypeError(
        `[Goribu] assetPathForRoute expected a fully static route, but "${route.id}" has a dynamic segment.`,
      );
    }
    return segment.value;
  });

  if (segments.length === 0) return "index.html";
  return `${segments.join("/")}.html`;
}

/**
 * Build the URL pathname the Worker is asked to render this route at.
 *
 * Each static segment is a raw filesystem name, so it is percent-encoded into one
 * path segment: a literal `?`, `#`, or `%` in a file name becomes URL data rather
 * than query, fragment, or escape syntax, and the Worker's matcher decodes it back
 * to the same name. The root route is `/`.
 */
export function requestPathnameForRoute(route) {
  const segments = route.segments.map((segment) => {
    if (segment.type !== "static") {
      throw new TypeError(
        `[Goribu] requestPathnameForRoute expected a fully static route, but "${route.id}" has a dynamic segment.`,
      );
    }
    return encodeURIComponent(segment.value);
  });

  return `/${segments.join("/")}`;
}
