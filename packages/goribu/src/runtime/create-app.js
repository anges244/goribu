import { matchRoute } from "../routing/match-route.js";
import { renderPage } from "../rendering/render-page.js";
import { renderNotFound } from "../rendering/render-not-found.js";
import { DefaultDocument } from "../rendering/document.js";
import { createRequest } from "./create-request.js";
import { createResponse, isResponseResult } from "./create-response.js";
import { createCookieJar } from "./cookies/create-cookie-jar.js";
import { appendSetCookies } from "./cookies/append-set-cookies.js";
import { flattenMiddlewareModules } from "./flatten-middleware-modules.js";
import { composeMiddleware } from "./compose-middleware.js";
import { finalizeDevelopmentErrorResponse } from "./finalize-development-error-response.js";
import { finalizeErrorResponse } from "./finalize-error-response.js";

const CALLER = "createApp({ manifest, modules, errorPages, documentId })";

// Statuses that cannot carry a response body. A terminal helper that produced a
// body for one of these is a handler mistake, caught here rather than shipped.
const BODYLESS_STATUSES = new Set([204, 205, 304]);

/**
 * Create Goribu's Cloudflare Worker entrypoint for a routed, rendered app.
 *
 * Build integration prepares every input: the route manifest, a map from each
 * route's source ID to its loaded module, the discovered `_404` identity, and
 * the discovered `_document` identity. This boundary closes over that
 * application-constant data and turns each Web Request into a matched response:
 * a streamed page, or the result a named method handler returns through the
 * response builder. A handler receives Goribu's request surface (method, path,
 * params, query, headers, and the body helpers) and returns any res.* intent:
 * res.text(), res.json(), res.redirect(), res.render(props) to stream the route's
 * own page with data, or res.notFound(props) for the _404 page. Worker bindings
 * and req.waitUntil, folder middleware, cookies, and the `_500` boundary are
 * later substeps of this block.
 *
 * @param {{
 *   manifest: object[],
 *   modules: Map<string, object>,
 *   errorPages: { notFound: string|null, serverError?: string|null },
 *   documentId: string|null,
 *   middlewareByRoute?: Map<string, Array<{ id: string, relativePath: string }>>,
 *   mode?: "development"|"production",
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
      `[Goribu] ${CALLER} requires errorPages to be the discovered { notFound, serverError } identities.`,
    );
  }

  const mode = options.mode ?? "production";
  if (mode !== "development" && mode !== "production") {
    throw new TypeError(
      `[Goribu] ${CALLER} requires mode to be "development" or "production". Pass the mode baked into the generated Worker.`,
    );
  }

  const middlewareByRoute = options.middlewareByRoute ?? new Map();
  if (!(middlewareByRoute instanceof Map)) {
    throw new TypeError(
      `[Goribu] ${CALLER} requires middlewareByRoute to be the build-prepared Map from route IDs to ordered middleware descriptors.`,
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
  const serverErrorId = errorPages.serverError ?? null;
  const ServerErrorPage =
    serverErrorId === null
      ? null
      : loadDefaultExport(modules, serverErrorId, "_500 page");
  const middlewareRunners = createMiddlewareRunners(middlewareByRoute, modules);

  return Object.freeze({
    async fetch(request) {
      if (!(request instanceof Request)) {
        throw new TypeError(
          "[Goribu] app.fetch(request) requires the Web Request received by the Cloudflare Worker fetch handler.",
        );
      }

      const url = new URL(request.url);

      // Canonicalize the trailing slash before anything else, so one URL serves
      // each route. The canonical form drops the trailing slash (the root "/" is
      // the only path that keeps it); the static-asset handler is configured with
      // the same drop-trailing-slash policy, so static and dynamic routes agree.
      // 308 preserves the method and body, so the rule is safe for every request.
      const canonical = canonicalPathname(url.pathname);
      if (canonical !== null) {
        const target = new URL(url);
        target.pathname = canonical;
        return Response.redirect(target.toString(), 308);
      }

      const cookieJar = createCookieJar(request);
      const match = matchRoute({
        manifest,
        pathname: url.pathname,
        method: request.method,
      });

      let response;
      try {
        response = await resolveResponse(match, url, request, cookieJar);
      } catch (error) {
        response =
          mode === "development"
            ? finalizeDevelopmentErrorResponse({
                error,
                url: url.pathname,
              })
            : await finalizeErrorResponse({
                error,
                url: url.pathname,
                Page: ServerErrorPage,
                Document,
              });
      }
      const flushed = appendSetCookies(response, cookieJar.pending);

      // One HEAD boundary for every path: a HEAD response shares GET's status and
      // headers but never carries a body. Normalizing here, rather than in the
      // matched-page branch, keeps the unmatched HEAD (a not-found body) and every
      // later response path correct without each remembering the rule.
      if (request.method.toUpperCase() === "HEAD") {
        return new Response(null, {
          status: flushed.status,
          headers: flushed.headers,
        });
      }
      return flushed;
    },
  });

  function resolveResponse(match, url, request, cookieJar) {
    switch (match.kind) {
      // A route that exports a handler for the request method: run it and
      // finalize what it returns through the response builder.
      case "handler": {
        const runMiddleware = middlewareRunners.get(match.route.id);
        if (runMiddleware) {
          return dispatchWithMiddleware(
            match,
            { kind: "handler", method: match.method },
            request,
            cookieJar,
            runMiddleware,
          );
        }
        return dispatchHandler(match, match.method, request, cookieJar);
      }

      case "page": {
        const runMiddleware = middlewareRunners.get(match.route.id);
        if (runMiddleware) {
          return dispatchWithMiddleware(
            match,
            { kind: "page", method: "GET" },
            request,
            cookieJar,
            runMiddleware,
          );
        }
        return renderPage({
          Page: loadDefaultExport(modules, match.route.id, "route"),
          Document,
        });
      }

      // A matched HEAD arrives as "automatic-head" and the HEAD boundary above
      // drops the body. Its target is whatever GET would serve: a handler when
      // the route exports GET, otherwise the default page.
      case "automatic-head": {
        const runMiddleware = middlewareRunners.get(match.route.id);
        if (runMiddleware) {
          return dispatchWithMiddleware(
            match,
            { ...match.target, method: "GET" },
            request,
            cookieJar,
            runMiddleware,
          );
        }
        if (match.target?.kind === "handler") {
          return dispatchHandler(match, match.target.method, request, cookieJar);
        }
        return renderPage({
          Page: loadDefaultExport(modules, match.route.id, "route"),
          Document,
        });
      }

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
        throw new TypeError(
          `[Goribu] Unsupported route match "${match.kind}" for "${url.pathname}".`,
        );
    }
  }

  // Run selected middleware with the same request and response objects the
  // handler receives if the chain continues. A terminal middleware intent uses
  // the same finalization path as a handler; an implicit page finalizes
  // res.render({}) so status and headers accumulated by continuing middleware
  // reach the streamed response.
  async function dispatchWithMiddleware(
    match,
    target,
    request,
    cookieJar,
    runMiddleware,
  ) {
    const req = createRequest(request, match.params, { cookies: cookieJar });
    const res = createResponse({ canRender: match.route.hasDefaultExport });
    const result = await runMiddleware(req, res);

    if (isResponseResult(result)) {
      return finalizeMatchedResult(result, match, target.method);
    }
    if (target.kind === "handler") {
      return dispatchHandler(match, target.method, request, cookieJar, { req, res });
    }
    return finalizeMatchedResult(res.render({}), match, target.method);
  }

  // Run one named method handler and finalize its response-builder result. The
  // handler receives Goribu's request surface (method, path, params, query,
  // headers, the body helpers, and the request cookie jar) and the response
  // builder. Worker bindings (req.env) and req.waitUntil arrive when createApp
  // is given env/ctx in a later substep.
  async function dispatchHandler(match, method, request, cookieJar, prepared) {
    if (!modules.has(match.route.id)) {
      throw new Error(
        `[Goribu] The route module "${match.route.id}" was matched but is not in the loaded module map. ` +
          "Rebuild so every manifest route has a loaded module.",
      );
    }

    const handler = modules.get(match.route.id)?.[method];
    if (typeof handler !== "function") {
      throw new TypeError(
        `[Goribu] Loaded route module "${match.route.id}" does not export a callable ${method} handler. ` +
          `Export \`export function ${method}(req, res)\` from the route file.`,
      );
    }

    const req =
      prepared?.req ?? createRequest(request, match.params, { cookies: cookieJar });
    const res =
      prepared?.res ?? createResponse({ canRender: match.route.hasDefaultExport });
    const result = await handler(req, res);
    return finalizeMatchedResult(result, match, method);
  }

  function finalizeMatchedResult(result, match, method) {
    return finalizeHandlerResult(result, {
      method,
      routeId: match.route.id,
      Document,
      NotFoundPage,
      // Only a route with a default page reaches res.render(); createResponse
      // enforces that, so resolve the component lazily — a res.json() result
      // never loads it.
      getPage: () => loadDefaultExport(modules, match.route.id, "route"),
    });
  }
}

/**
 * Bind build-selected middleware descriptors to loaded modules and compose one
 * reusable runner per route. Empty selections deliberately produce no runner so
 * routes without middleware keep their existing dispatch and render paths.
 */
function createMiddlewareRunners(middlewareByRoute, modules) {
  const runners = new Map();

  for (const [routeId, descriptors] of middlewareByRoute) {
    if (typeof routeId !== "string" || routeId.length === 0 || !Array.isArray(descriptors)) {
      throw new TypeError(
        "[Goribu] middlewareByRoute must map each route ID to its ordered middleware descriptor array. Rebuild the Worker entry so Goribu can prepare middleware selection.",
      );
    }

    const bindings = descriptors.map((descriptor, index) => {
      if (
        descriptor === null ||
        typeof descriptor !== "object" ||
        typeof descriptor.id !== "string" ||
        descriptor.id.length === 0 ||
        typeof descriptor.relativePath !== "string" ||
        descriptor.relativePath.length === 0
      ) {
        throw new TypeError(
          `[Goribu] Middleware descriptor at index ${index} for route ${JSON.stringify(routeId)} is invalid. ` +
            "Rebuild the Worker entry so each descriptor has an id and relativePath.",
        );
      }
      if (!modules.has(descriptor.id)) {
        throw new Error(
          `[Goribu] Middleware module ${JSON.stringify(descriptor.id)} selected for route ${JSON.stringify(routeId)} is not in the loaded module map. ` +
            "Rebuild so every selected middleware module is imported.",
        );
      }

      return {
        source: {
          filePath: descriptor.relativePath,
          relativePath: descriptor.relativePath,
        },
        module: modules.get(descriptor.id),
      };
    });
    const middleware = flattenMiddlewareModules(bindings);
    if (middleware.length > 0) {
      runners.set(routeId, composeMiddleware(middleware));
    }
  }

  return runners;
}

/**
 * Return the canonical, trailing-slash-free form of a pathname, or null when the
 * pathname is already canonical. Every trailing slash is dropped in one step so a
 * request never chains through more than one redirect; the root "/" is preserved.
 */
function canonicalPathname(pathname) {
  if (pathname === "/") return null;
  const stripped = pathname.replace(/\/+$/, "");
  const canonical = stripped === "" ? "/" : stripped;
  return canonical === pathname ? null : canonical;
}

/**
 * Turn a handler's response-builder result into a Web Response, or fail with a
 * message that teaches how to return a valid one. Body-bearing and redirect
 * intents become a Web Response directly; res.render(props) and res.notFound(props)
 * stream the matched page (or the app's _404 page) through the same document shell
 * a page match uses, carrying the handler's props, status, and extra headers.
 *
 * @param {object} result
 * @param {{ method: string, routeId: string, Document: Function, NotFoundPage: Function|null, getPage: () => Function }} options
 */
async function finalizeHandlerResult(result, options) {
  const { method, routeId } = options;
  if (!isResponseResult(result)) {
    const identity = `${method} handler for route ${JSON.stringify(routeId)}`;
    if (result === undefined) {
      throw new TypeError(
        `[Goribu] The ${identity} did not return a response. ` +
          "Return a res.* result such as res.json(), res.text(), or res.redirect().",
      );
    }
    if (result instanceof Response) {
      throw new TypeError(
        `[Goribu] The ${identity} returned a Web Response. ` +
          "Return a res.* result instead so Goribu can apply framework behavior.",
      );
    }
    throw new TypeError(
      `[Goribu] The ${identity} returned a non-response value. ` +
        "Return a genuine res.* result instead of a string, the response builder, or a plain object.",
    );
  }

  if (
    result.kind === "text" ||
    result.kind === "json" ||
    result.kind === "invalid"
  ) {
    if (BODYLESS_STATUSES.has(result.status)) {
      throw new RangeError(
        `[Goribu] Cannot send a ${result.kind} response with status ${result.status} because that status cannot carry a response body. ` +
          "Choose a body-bearing status before calling the terminal response helper.",
      );
    }
    return new Response(result.body, {
      status: result.status,
      headers: toWebHeaders(result.headers),
    });
  }

  if (result.kind === "redirect") {
    return new Response(null, {
      status: result.status,
      headers: toWebHeaders(result.headers),
    });
  }

  // res.render(props) streams the matched route's own default page through the
  // document shell with the handler's props, status, and headers — the same
  // render path a page match uses, so a handler-rendered page is identical to an
  // implicit-GET one apart from the data it carries.
  if (result.kind === "render") {
    if (BODYLESS_STATUSES.has(result.status)) {
      throw new RangeError(
        `[Goribu] Cannot render a page with status ${result.status} because that status cannot carry a response body. ` +
          "Choose a body-bearing status before calling res.render(props).",
      );
    }
    return renderPage({
      Page: options.getPage(),
      Document: options.Document,
      props: result.props,
      status: result.status,
      headers: result.headers,
    });
  }

  // res.notFound(props) renders the application's _404 page (or the built-in one)
  // through the same boundary a route miss uses, always with a 404 status.
  if (result.kind === "not-found") {
    return renderNotFound({
      NotFoundPage: options.NotFoundPage,
      Document: options.Document,
      props: result.props,
      headers: result.headers,
    });
  }

  throw new TypeError(
    `[Goribu] Cannot finalize unknown response result kind ${JSON.stringify(result.kind)}. ` +
      "Return the result from a supported res.* terminal helper.",
  );
}

/**
 * Convert a response-builder headers snapshot (string or array-of-string values)
 * into Web Headers, appending each entry of an array so repeated headers survive.
 */
function toWebHeaders(values) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
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
