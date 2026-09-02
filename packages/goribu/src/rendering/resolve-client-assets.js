/**
 * Resolve the browser asset URLs one server-rendered page must reference.
 *
 * Given the build-prepared client asset manifest and the matched route ID, this
 * pure function names the hashed module entry to boot, the chunks worth
 * preloading (the shared entry graph plus the matched page's lazy chunk), and the
 * stylesheets to apply. It never touches route handlers or server-only code: the
 * manifest already describes only tree-shaken browser output.
 */

const CALLER = "resolveClientAssets({ manifest, routeId, base })";

/**
 * @param {{
 *   manifest: { entry: { file: string, imports?: string[], css?: string[] }, pages?: Record<string, { file: string, imports?: string[], css?: string[] }> },
 *   routeId?: string|null,
 *   base?: string,
 * }} options
 * @returns {{ src: string, modulePreloads: string[], styles: string[] }}
 */
export function resolveClientAssets(options) {
  const manifest = options?.manifest;
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new TypeError(
      `[Goribu] ${CALLER} requires the client asset manifest emitted by Goribu's production client build.`,
    );
  }

  const entry = manifest.entry;
  if (entry === null || typeof entry !== "object" || typeof entry.file !== "string" || entry.file.length === 0) {
    throw new TypeError(
      `[Goribu] ${CALLER} requires manifest.entry.file to name the emitted browser entry chunk. Pass the unchanged manifest from Goribu's client build.`,
    );
  }

  const base = normalizeBase(options?.base);
  const routeId = options?.routeId;
  const page =
    typeof routeId === "string" && routeId.length > 0
      ? manifest.pages?.[routeId] ?? null
      : null;

  const entrySource = withBase(base, entry.file);
  const preloads = new Set();
  const styles = new Set();

  for (const chunk of entry.imports ?? []) preloads.add(withBase(base, chunk));
  for (const style of entry.css ?? []) styles.add(withBase(base, style));

  if (page !== null && typeof page === "object" && typeof page.file === "string") {
    preloads.add(withBase(base, page.file));
    for (const chunk of page.imports ?? []) preloads.add(withBase(base, chunk));
    for (const style of page.css ?? []) styles.add(withBase(base, style));
  }

  // The entry is booted through its own module script, never double-fetched as a
  // preload, even if a page's static graph happens to reference it.
  preloads.delete(entrySource);

  return Object.freeze({
    src: entrySource,
    modulePreloads: Object.freeze([...preloads]),
    styles: Object.freeze([...styles]),
  });
}

function normalizeBase(base) {
  if (base === undefined || base === "/") return "/";
  if (typeof base !== "string" || base.length === 0) {
    throw new TypeError(
      `[Goribu] ${CALLER} requires base to be the production client base path string when provided.`,
    );
  }
  return base.endsWith("/") ? base : `${base}/`;
}

function withBase(base, file) {
  if (typeof file !== "string" || file.length === 0) {
    throw new TypeError(
      `[Goribu] ${CALLER} received a client manifest entry with an empty file name. Regenerate the manifest from Goribu's client build.`,
    );
  }
  const cleaned = file.startsWith("/") ? file.slice(1) : file;
  return `${base}${cleaned}`;
}
