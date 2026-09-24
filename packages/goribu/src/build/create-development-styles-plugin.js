import { resolve } from "node:path";
import { parse } from "@babel/parser";
import { generateManifest } from "../routing/generate-manifest.js";

const STYLE_PATH = "/_goribu/dev-styles.css";
const CSS = /\.(?:css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:\?|$)/;
const NON_STYLE_IMPORT = /[?&](?:inline|raw|url|worker|sharedworker)(?:[=&]|$)/;

/** Serve initial CSS through Vite's live transforms, before browser JS runs. */
export function createDevelopmentStylesPlugin() {
  return {
    name: "goribu:development-styles",
    apply: "serve",

    configureServer(server) {
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
            const routes = generateManifest({
              projectRoot: server.config.root,
              routesDir: resolve(server.config.root, "src/routes"),
            });
            const route = routes.find(
              (candidate) => candidate.id === routeId && candidate.hasDefaultExport,
            );
            if (!route) {
              response.statusCode = 404;
              return response.end("[Goribu] Unknown stylesheet route. Reload the page after fixing the route file.");
            }
            roots.push(`/${route.id}`);
          }
          const styles = await collectStyles(server.environments.client, roots, base);
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

async function collectStyles(environment, roots, base) {
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
    const ast = parse(transformed.code, { sourceType: "module" });
    for (const statement of ast.program.body) {
      if (
        statement.type === "ImportDeclaration" ||
        statement.type === "ExportNamedDeclaration" ||
        statement.type === "ExportAllDeclaration"
      ) {
        if (!statement.source) continue;
        const source = statement.source.value;
        const dependency = source.startsWith(".")
          ? new URL(source, `http://goribu.local${url}`)
          : null;
        await visit(dependency ? dependency.pathname + dependency.search : source);
      }
    }
  }
  for (const root of roots) await visit(root);
  return [...styles];
}
