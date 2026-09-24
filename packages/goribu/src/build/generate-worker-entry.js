import { dirname, join, relative, resolve, sep } from "node:path";
import { generateManifest } from "../routing/generate-manifest.js";
import { scanErrorPages } from "../routing/scan-error-pages.js";
import { scanDocument } from "../routing/scan-document.js";
import { selectMiddlewareByRoute } from "./select-middleware-by-route.js";
import { writeGeneratedFile } from "./write-generated-file.js";

const GENERATED_DIRECTORY = ".goribu";
const WORKER_FILENAME = "worker.js";
const ROUTES_DIRECTORY = join("src", "routes");
const APPLICATION_CONFIG_FILENAME = "goribu.config.js";

/**
 * Generate the Worker entry into `<projectRoot>/.goribu/worker.js`.
 *
 * The generator scans `src/routes`, builds the route manifest, discovers an
 * optional `_404` page and folder middleware, and emits a Worker that statically
 * imports every selected module and hands the prepared data to `createApp`.
 * Static imports keep routes and middleware in the Worker bundle; the runtime
 * never touches the filesystem. A route may default-export a page, export named
 * HTTP method handlers, or both; the runtime dispatches whichever the matched
 * request calls for.
 *
 * @param {{ projectRoot: string }} options
 * @returns {{ outputFile: string, source: string }}
 */
export function writeWorkerEntry(options) {
  const projectRoot = options?.projectRoot;
  const mode = options?.mode ?? "production";
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new TypeError(
      "[Goribu] writeWorkerEntry({ projectRoot }) requires the application project root.",
    );
  }
  if (mode !== "development" && mode !== "production") {
    throw new TypeError(
      '[Goribu] writeWorkerEntry({ projectRoot, mode }) requires mode to be "development" or "production". Pass the mode derived from Vite\'s command.',
    );
  }

  const root = resolve(projectRoot);
  const outputFile = join(root, GENERATED_DIRECTORY, WORKER_FILENAME);
  const workerDirectory = dirname(outputFile);
  const routesDir = join(root, ROUTES_DIRECTORY);
  const applicationConfigSpecifier = relativeImportSpecifier(
    workerDirectory,
    join(root, APPLICATION_CONFIG_FILENAME),
  );

  const manifest = generateManifest({ routesDir, projectRoot: root });
  if (manifest.length === 0) {
    throw new Error(
      `[Goribu] Cannot generate the Worker entry because no routes were found in ${JSON.stringify(routesDir)}. ` +
        "Add at least one route file, for example src/routes/index.jsx that default-exports a React component.",
    );
  }
  const errorPages = scanErrorPages(routesDir);
  const notFoundId =
    errorPages.notFound === null ? null : routeId(errorPages.notFound, root);
  const serverErrorId =
    errorPages.serverError === null
      ? null
      : routeId(errorPages.serverError, root);

  const documentFile = scanDocument(root);
  const documentId = documentFile === null ? null : routeId(documentFile, root);

  // Collect every module the Worker must import, keyed by its stable route ID so
  // the runtime map and the manifest agree on one identity per module.
  const moduleSources = new Map();
  for (const route of manifest) moduleSources.set(route.id, route.filePath);
  if (notFoundId !== null) moduleSources.set(notFoundId, errorPages.notFound);
  if (serverErrorId !== null) {
    moduleSources.set(serverErrorId, errorPages.serverError);
  }
  if (documentId !== null) moduleSources.set(documentId, documentFile);

  const middlewareByRoute = selectMiddlewareByRoute({
    routesDir,
    manifest,
    projectRoot: root,
  });
  for (const descriptors of middlewareByRoute.values()) {
    for (const descriptor of descriptors) {
      moduleSources.set(descriptor.id, join(root, ...descriptor.id.split("/")));
    }
  }

  const imports = [...moduleSources].map(([id, filePath], index) => ({
    id,
    binding: `module${index}`,
    specifier: relativeImportSpecifier(workerDirectory, filePath),
  }));

  const source = generateWorkerEntrySource({
    imports,
    manifest: manifest.map((route) =>
      serializeRouteForManifest(route, middlewareByRoute.get(route.id) ?? []),
    ),
    notFoundId,
    serverErrorId,
    documentId,
    middlewareByRoute,
    mode,
    applicationConfigSpecifier,
  });

  writeGeneratedFile(outputFile, source);
  return Object.freeze({ outputFile, source });
}

/** Keep only the fields the runtime matcher reads. The absolute file path stays
 * out of the bundle; modules are reached through the loaded module map instead. */
function serializeRouteForManifest(route, middleware) {
  return {
    id: route.id,
    pattern: route.pattern,
    segments: route.segments,
    methods: route.methods,
    hasDefaultExport: route.hasDefaultExport,
    staticCandidate:
      route.prerenderEligible &&
      route.segments.every((segment) => segment.type === "static") &&
      middleware.length === 0,
  };
}

function routeId(filePath, projectRoot) {
  return relative(projectRoot, filePath).split(sep).join("/");
}

function generateWorkerEntrySource({
  imports,
  manifest,
  notFoundId,
  serverErrorId,
  documentId,
  middlewareByRoute,
  mode,
  applicationConfigSpecifier,
}) {
  const lines = [
    "// Generated by Goribu. Do not edit.",
    'import { createApp } from "goribu/server";',
    'import { clientAssetBase, clientAssetManifest } from "virtual:goribu/client-assets";',
    `import applicationConfig from ${JSON.stringify(applicationConfigSpecifier)};`,
    ...imports.map(
      ({ binding, specifier }) =>
        `import * as ${binding} from ${JSON.stringify(specifier)};`,
    ),
    "",
    `const manifest = ${JSON.stringify(manifest, null, 2)};`,
    "",
    "const modules = new Map([",
    ...imports.map(({ id, binding }) => `  [${JSON.stringify(id)}, ${binding}],`),
    "]);",
    "",
    `const errorPages = { notFound: ${JSON.stringify(notFoundId)}, serverError: ${JSON.stringify(serverErrorId)} };`,
    `const documentId = ${JSON.stringify(documentId)};`,
    `const mode = ${JSON.stringify(mode)};`,
    `const middlewareByRoute = new Map(${JSON.stringify([...middlewareByRoute], null, 2)});`,
    "",
    "export default createApp({ manifest, modules, errorPages, documentId, middlewareByRoute, mode, clientAssetManifest, clientAssetBase, applicationConfig });",
    "",
  ];

  return lines.join("\n");
}

function relativeImportSpecifier(fromDirectory, source) {
  let specifier = relative(fromDirectory, source).split(sep).join("/");
  if (!specifier.startsWith(".")) specifier = `./${specifier}`;

  // ESM treats these characters as URL syntax. Escape them so valid source
  // filenames remain filesystem paths rather than query or fragment delimiters.
  return specifier
    .replaceAll("%", "%25")
    .replaceAll("?", "%3F")
    .replaceAll("#", "%23");
}
