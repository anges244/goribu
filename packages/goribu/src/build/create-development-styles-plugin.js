import { parse } from "@babel/parser";

const STYLE_PATH = "/_goribu/dev-styles.css";
const CSS = /\.(?:css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:\?|$)/;
const NON_STYLE_IMPORT = /[?&](?:inline|raw|url|worker|sharedworker)(?:[=&]|$)/;

/** Serve initial CSS through Vite's live transforms, before browser JS runs. */
export function createDevelopmentStylesPlugin(pageIds) {
  return {
    name: "goribu:development-styles",
    apply: "serve",

    configureServer(server) {
      // Weak keys let Vite release obsolete transforms after edits/restarts.
      // Only import strings survive parsing; never retain the syntax tree.
      const importsByTransform = new WeakMap();
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url, "http://goribu.local");
        const base = server.config.base;
        if (url.pathname !== `${base.slice(0, -1)}${STYLE_PATH}`) return next();
        response.setHeader("Cache-Control", "no-store");
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.statusCode = 405;
          response.setHeader("Allow", "GET, HEAD");
          return response.end();
        }

        try {
          const routeId = url.searchParams.get("route");
          const roots = ["/src/setup/client-entry.js"];
          if (routeId !== null) {
            if (!pageIds.has(routeId)) {
              response.statusCode = 404;
              return response.end("[Goribu] Unknown stylesheet route. Reload the page after fixing the route file.");
            }
            roots.push(`/${routeId}`);
          }
          const styles = await collectStyles(server.environments.client, roots, base, importsByTransform);
          response.setHeader("Content-Type", "text/css; charset=utf-8");
          response.end(request.method === "HEAD"
            ? undefined
            : styles.map((href) => `@import ${JSON.stringify(href)};`).join("\n"));
        } catch (error) {
          server.config.logger.error(`[Goribu] Could not load development styles: ${error.message}`);
          response.statusCode = 500;
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          response.end("[Goribu] Could not load development styles. Fix the client import or stylesheet error in the dev-server output, then reload.");
        }
      });
    },
  };
}

async function collectStyles(environment, roots, base, importsByTransform) {
  const seen = new Set();
  const styles = new Set();
  async function visit(url) {
    // Import analysis has resolved these to browser URLs. Do not fetch external
    // imports, explicitly non-injected CSS, or handler-only server modules.
    if (
      /^(?:https?:|data:)/.test(url) ||
      NON_STYLE_IMPORT.test(url) ||
      /\.server\.[^/?]+(?:\?|$)/.test(url)
    ) return;
    if (base !== "/" && url.startsWith(base)) url = `/${url.slice(base.length)}`;
    if (seen.has(url)) return;
    seen.add(url);
    if (CSS.test(url)) {
      const separator = url.includes("?") ? "&" : "?";
      styles.add(`${base.slice(0, -1)}${url}${separator}direct`);
      return;
    }
    const transformed = await environment.transformRequest(url);
    if (!transformed) {
      throw new Error(`Cannot inspect client module ${JSON.stringify(url)}. Fix its import and restart the dev server.`);
    }
    let cached = importsByTransform.get(transformed);
    // Compare code as well in case a transform result is updated in place.
    if (!cached || cached.code !== transformed.code) {
      cached = { code: transformed.code, sources: staticImports(transformed.code) };
      importsByTransform.set(transformed, cached);
    }
    for (const source of cached.sources) {
      const dependency = source.startsWith(".")
        ? new URL(source, `http://goribu.local${url}`)
        : null;
      await visit(dependency ? dependency.pathname + dependency.search : source);
    }
  }
  for (const root of roots) await visit(root);
  return [...styles];
}

function staticImports(code) {
  const ast = parse(code, { sourceType: "module" });
  const sources = [];
  for (const statement of ast.program.body) {
    if (
      statement.type === "ImportDeclaration" ||
      statement.type === "ExportNamedDeclaration" ||
      statement.type === "ExportAllDeclaration"
    ) {
      if (statement.source) sources.push(statement.source.value);
    }
  }
  return sources;
}
