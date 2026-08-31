import { matchRoute } from "../routing/match-route.js";
import { renderPage } from "../rendering/render-page.js";
import { renderNotFound } from "../rendering/render-not-found.js";
import { DefaultDocument } from "../rendering/document.js";

const CALLER = "createApp({ manifest, modules, errorPages, documentId })";

/**
 * Create Goribu's Cloudflare Worker entrypoint for a routed, rendered app.
 *
 * Build integration prepares every input: the route manifest, a map from each
 * route's source ID to its loaded module, the discovered `_404` identity, and
 * the discovered `_document` identity. This boundary closes over that
 * application-constant data and turns each Web Request into a matched, streamed
 * HTML response. Request handlers, middleware, cookies, and the `_500` boundary
 * are the request surface of a later block, so this block serves pages, the
 * not-found page, and the automatic method responses routing alone can answer.
 *
 * @param {{
 *   manifest: object[],
 *   modules: Map<string, object>,
 *   errorPages: { notFound: string|null },
 *   documentId: string|null,
 * }} options
 * @returns {{ fetch(request: Request): Promise<Response> }}
 */
export function createApp(options) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError(
      `[Goribu] ${CALLER} requires the build-prepared application options object.`,
    );
  }

  const manifest = options.manifest;
  if (!Array.isArray(manifest)) {
    throw new TypeError(
      `[Goribu] ${CALLER} requires manifest to be the route array generated from src/routes.`,
    );
  }

  const modules = options.modules;
  if (!(modules instanceof Map)) {
    throw new TypeError(
      `[Goribu] ${CALLER} requires modules to be a Map from route source IDs to loaded modules.`,
    );
  }

  const errorPages = options.errorPages;
  if (errorPages === null || typeof errorPages !== "object" || Array.isArray(errorPages)) {
    throw new TypeError(
      `[Goribu] ${CALLER} requires errorPages to be the discovered { notFound } identities.`,
    );
  }

  const documentId = options.documentId ?? null;
  const Document =
    documentId === null
      ? DefaultDocument
      : loadDefaultExport(modules, documentId, "_document");
  const notFoundId = errorPages.notFound ?? null;
  const NotFoundPage =
    notFoundId === null ? null : loadDefaultExport(modules, notFoundId, "_404 page");

  return Object.freeze({
    async fetch(request) {
      if (!(request instanceof Request)) {
        throw new TypeError(
          "[Goribu] app.fetch(request) requires the Web Request received by the Cloudflare Worker fetch handler.",
        );
      }

      const url = new URL(request.url);
      const match = matchRoute({
        manifest,
        pathname: url.pathname,
        method: request.method,
      });

      const response = await resolveResponse(match, url);

      // One HEAD boundary for every path: a HEAD response shares GET's status and
      // headers but never carries a body. Normalizing here, rather than in the
      // matched-page branch, keeps the unmatched HEAD (a not-found body) and every
      // later response path correct without each remembering the rule.
      if (request.method.toUpperCase() === "HEAD") {
        return new Response(null, {
          status: response.status,
          headers: response.headers,
        });
      }
      return response;
    },
  });

  function resolveResponse(match, url) {
    switch (match.kind) {
      // A matched HEAD arrives as "automatic-head"; it renders the same page as
      // GET and the HEAD boundary above drops the body. Its target is always a
      // page in this block because routes exporting handlers are rejected at build.
      case "page":
      case "automatic-head":
        return renderPage({
          Page: loadDefaultExport(modules, match.route.id, "route"),
          Document,
        });

      case "automatic-options":
        return new Response(null, {
          status: 204,
          headers: { allow: match.allowedMethods.join(", ") },
        });

      case "method-not-allowed":
        return new Response(null, {
          status: 405,
          headers: { allow: match.allowedMethods.join(", ") },
        });

      case "not-found":
        return renderNotFound({ NotFoundPage, Document });

      default:
        // "handler" is unreachable: the build rejects routes that export HTTP
        // handlers until the request surface lands. Fail closed if one appears.
        throw new TypeError(
          `[Goribu] Unsupported route match "${match.kind}" for "${url.pathname}". Request handlers arrive in a later block.`,
        );
    }
  }
}

/**
 * Read one route module's default export as a React component, or fail with a
 * message that points at the exact route source that is misconfigured.
 */
function loadDefaultExport(modules, id, role) {
  if (!modules.has(id)) {
    throw new Error(
      `[Goribu] The ${role} module "${id}" was matched but is not in the loaded module map. ` +
        "Rebuild so every manifest route has a loaded module.",
    );
  }

  const component = modules.get(id)?.default;
  if (typeof component !== "function") {
    throw new TypeError(
      `[Goribu] The ${role} module "${id}" has no default-exported React component. ` +
        "Export a React component as the file's default export.",
    );
  }

  return component;
}
