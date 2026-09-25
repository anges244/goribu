import { parse } from "@babel/parser";
import { extname } from "node:path";
import {
  HANDLER_METHODS,
  isHandlerMethod,
} from "./handler-methods.js";

// An Abstract Syntax Tree (AST) is the parser's object representation of source
// code. For example, `export function GET() {}` becomes an export object that
// contains a function object named `GET`. Reading those objects is safer than
// searching source text, where comments and strings can look like real exports.

/**
 * Read one route file's source and describe the exports Goribu cares about.
 *
 * The result answers three questions for later routing steps:
 * - Does this route export a default page component?
 * - Which HTTP handler names does it export?
 * - Did it explicitly force or disable prerendering?
 *
 * This function never rewrites the source and does not decide whether a
 * prerender attempt will work. That decision is verified later by the build.
 *
 * @param {string} source The complete text of one route file.
 * @param {string} filePath The route's path, used to select syntax and report errors.
 * @returns {{ hasDefaultExport: boolean, methods: string[], prerender: boolean | null }}
 */
export function analyzeRouteModule(source, filePath) {
  // This helper is called by Goribu itself. If either input is missing, report
  // an internal calling mistake rather than pretending the route has bad syntax.
  if (typeof source !== "string" || typeof filePath !== "string") {
    throw new TypeError(
      "[Goribu] analyzeRouteModule(source, filePath) requires route source and its file path.",
    );
  }

  // Convert the source text into one syntax tree. The parser mode comes from the
  // filename so TypeScript and JSX are understood without transforming the file.
  let syntaxTree;
  try {
    syntaxTree = parse(source, {
      plugins: parserPlugins(filePath),
      sourceFilename: filePath,
      sourceType: "module",
    });
  } catch (cause) {
    throw new SyntaxError(
      `[Goribu] Could not parse route module "${filePath}". ` +
        `Fix the syntax error and try again. ${cause.message}`,
      { cause },
    );
  }

  // Record which local names survive TypeScript erasure before reading exports.
  // This stays within the same parsed syntax tree, including namespace bodies;
  // it does not trace imported modules or inspect function bodies.
  const bindingKinds = collectBindingKinds(syntaxTree.program.body);

  // Store every runtime route fact discovered from the parsed module. A Set
  // prevents the same handler name from being added twice.
  const found = {
    hasDefaultExport: false,
    methods: new Set(),
    prerender: null,
  };

  // `program.body` is the ordered list of statements at the top of the route
  // file. Goribu's route contract uses top-level exports, so there is no reason
  // to recursively inspect function bodies or JSX.
  for (const statement of syntaxTree.program.body) {
    // This covers `export default function Page() {}` and any other direct
    // default export. A default export means the route has a page component.
    if (statement.type === "ExportDefaultDeclaration") {
      // TypeScript permits forms such as `export default interface Page {}`.
      // They disappear at runtime, so they cannot provide a page component.
      if (
        !isTypeOnlyDeclaration(statement.declaration) &&
        !isTypeOnlyLocal(statement.declaration, bindingKinds)
      ) {
        found.hasDefaultExport = true;
      }
      continue;
    }

    // Ignore imports and ordinary declarations. Only named exports can define
    // HTTP handlers or the `prerender` override.
    if (statement.type !== "ExportNamedDeclaration") continue;

    // `export type { T as GET }` uses a runtime-looking public name but emits
    // nothing. Ignore the whole statement before inspecting names.
    if (statement.exportKind === "type") continue;

    // In `export function GET() {}`, Babel puts the function declaration directly
    // on the export statement. The same is true for `export const prerender`.
    if (statement.declaration) {
      inspectDeclaration(statement.declaration, filePath, found);
    }

    // In `export { save as POST }`, Babel stores each exported item separately.
    // We inspect the public name (`POST`), not the local name (`save`).
    for (const specifier of statement.specifiers) {
      // TypeScript also allows type-only specifiers inside a value export:
      // `export { type Handler as GET }`.
      if (specifier.exportKind === "type") continue;

      // A value-looking alias can still point at an erased local declaration,
      // such as `type Handler = ...; export { Handler as GET }`.
      if (
        !statement.source &&
        isTypeOnlyLocal(specifier.local, bindingKinds)
      ) {
        continue;
      }

      const name = exportedName(specifier.exported);
      assertHandlerCasing(name, filePath);
      if (name === "default") found.hasDefaultExport = true;
      if (isHandlerMethod(name)) found.methods.add(name);
      if (name === "prerender") throw invalidPrerenderError(filePath);
    }
  }

  // Always return handlers in the framework's official order. Reordering
  // functions inside a route file therefore cannot change generated output.
  return {
    hasDefaultExport: found.hasDefaultExport,
    methods: HANDLER_METHODS.filter((method) => found.methods.has(method)),
    prerender: found.prerender,
  };
}

/**
 * Tell Babel which language features the file may contain.
 *
 * `.tsx` combines TypeScript and JSX, `.ts` uses TypeScript without JSX, and
 * JavaScript routes allow JSX because Goribu supports components in `.js` files.
 */
function parserPlugins(filePath) {
  const extension = extname(filePath);
  if (extension === ".tsx") return ["jsx", "typescript"];
  if (extension === ".ts") return ["typescript"];
  return ["jsx"];
}

/**
 * Classify top-level local bindings as runtime values or TypeScript-only names.
 * Runtime wins when TypeScript declaration merging gives one name both kinds.
 */
function collectBindingKinds(statements) {
  const runtime = new Set();
  const typeOnly = new Set();

  const addRuntime = (name) => {
    if (name) runtime.add(name);
  };
  const addTypeOnly = (name) => {
    if (name) typeOnly.add(name);
  };

  for (const statement of statements) {
    if (statement.type === "ImportDeclaration") {
      for (const specifier of statement.specifiers) {
        const add =
          statement.importKind === "type" || specifier.importKind === "type"
            ? addTypeOnly
            : addRuntime;
        add(specifier.local?.name);
      }
      continue;
    }

    const declaration =
      statement.type === "ExportNamedDeclaration" ||
      statement.type === "ExportDefaultDeclaration"
        ? statement.declaration
        : statement;
    collectDeclarationBindings(declaration, { addRuntime, addTypeOnly });
  }

  return { runtime, typeOnly };
}

function collectDeclarationBindings(declaration, bindings) {
  if (!declaration) return;

  const add = isTypeOnlyDeclaration(declaration)
    ? bindings.addTypeOnly
    : isRuntimeDeclaration(declaration)
      ? bindings.addRuntime
      : null;
  if (!add) return;

  if (declaration.type === "VariableDeclaration") {
    for (const declarator of declaration.declarations) {
      collectPatternBindings(declarator.id, add);
    }
    return;
  }

  add(declaration.id?.name);
}

function collectPatternBindings(pattern, add) {
  if (!pattern) return;
  if (pattern.type === "Identifier") {
    add(pattern.name);
    return;
  }
  if (pattern.type === "RestElement") {
    collectPatternBindings(pattern.argument, add);
    return;
  }
  if (pattern.type === "AssignmentPattern") {
    collectPatternBindings(pattern.left, add);
    return;
  }
  if (pattern.type === "ArrayPattern") {
    for (const element of pattern.elements) collectPatternBindings(element, add);
    return;
  }
  if (pattern.type === "ObjectPattern") {
    for (const property of pattern.properties) {
      collectPatternBindings(
        property.type === "RestElement" ? property.argument : property.value,
        add,
      );
    }
  }
}

function isRuntimeDeclaration(declaration) {
  return (
    declaration.type === "FunctionDeclaration" ||
    declaration.type === "ClassDeclaration" ||
    declaration.type === "VariableDeclaration" ||
    declaration.type === "TSEnumDeclaration" ||
    declaration.type === "TSModuleDeclaration"
  );
}

function isTypeOnlyLocal(local, bindingKinds) {
  const name = local?.type === "Identifier" ? local.name : null;
  return (
    name !== null &&
    bindingKinds.typeOnly.has(name) &&
    !bindingKinds.runtime.has(name)
  );
}

/**
 * Read a declaration written directly after `export`.
 *
 * Examples include `export function GET() {}` and
 * `export const prerender = false`. Results are added to `found`.
 */
function inspectDeclaration(declaration, filePath, found) {
  // Ambient declarations describe runtime values to TypeScript but do not emit
  // those values. They cannot satisfy Goribu's runtime route contract.
  if (isTypeOnlyDeclaration(declaration)) return;

  assertHandlerCasing(declaration.id?.name, filePath);

  if (
    declaration.type === "FunctionDeclaration" ||
    declaration.type === "ClassDeclaration"
  ) {
    // Functions and classes carry their exported name on `id`.
    const name = declaration.id?.name;
    if (isHandlerMethod(name)) found.methods.add(name);
    if (name === "prerender") throw invalidPrerenderError(filePath);
    return;
  }

  // Other declarations, such as exported TypeScript interfaces, cannot define
  // runtime handlers or a prerender value.
  if (declaration.type !== "VariableDeclaration") return;

  // One statement may declare several values: `export const GET = ..., x = ...`.
  for (const declarator of declaration.declarations) {
    // Destructuring can export several handlers. Use binding names, not keys.
    collectPatternBindings(declarator.id, (name) => {
      assertHandlerCasing(name, filePath);
      if (isHandlerMethod(name)) found.methods.add(name);
    });
    // The prerender override still requires a direct boolean declaration.
    if (declarator.id.type !== "Identifier") continue;

    const name = declarator.id.name;
    if (name !== "prerender") continue;

    // Goribu accepts only the two forms a person can understand immediately:
    // `export const prerender = true` or `export const prerender = false`.
    // A variable, function call, or mutable `let` would require executing code
    // just to decide how the route should build.
    if (
      declaration.kind !== "const" ||
      declarator.init?.type !== "BooleanLiteral"
    ) {
      throw invalidPrerenderError(filePath);
    }

    found.prerender = declarator.init.value;
  }
}

function assertHandlerCasing(name, filePath) {
  if (typeof name !== "string") return;
  const method = name.toUpperCase();
  if (name === method || !isHandlerMethod(method)) return;

  throw new Error(
    `[Goribu] Route "${filePath}" exports "${name}". ` +
      `HTTP handlers must use uppercase names. Rename "${name}" to "${method}".`,
  );
}

/**
 * Identify declarations erased by TypeScript rather than emitted as module
 * values. The `declare` flag covers ambient functions, classes, and variables.
 */
function isTypeOnlyDeclaration(declaration) {
  return (
    declaration?.declare === true ||
    declaration?.type === "TSDeclareFunction" ||
    declaration?.type === "TSInterfaceDeclaration" ||
    declaration?.type === "TSTypeAliasDeclaration" ||
    (declaration?.type === "TSModuleDeclaration" && isErasedNamespace(declaration))
  );
}

function isErasedNamespace(declaration) {
  const body = declaration.body;
  // Babel represents a dotted namespace as nested module declarations.
  if (body?.type === "TSModuleDeclaration") return isErasedNamespace(body);
  if (body?.type !== "TSModuleBlock") return false;

  // Only type declarations and similarly erased namespaces prove erasure.
  // Ambient value declarations and even empty statements can make Vite emit
  // a namespace object, so the general declaration predicate is too broad here.
  return body.body.every((statement) => {
    const member = statement.type === "ExportNamedDeclaration"
      ? statement.declaration
      : statement;
    return (
      member?.type === "TSInterfaceDeclaration" ||
      member?.type === "TSTypeAliasDeclaration" ||
      (member?.type === "TSModuleDeclaration" && isErasedNamespace(member))
    );
  });
}

/**
 * Return the public name of an item inside `export { ... }`.
 *
 * Babel normally represents names as identifiers, but JavaScript also permits
 * string-named exports, so both parser shapes are handled.
 */
function exportedName(exported) {
  if (!exported) return null;
  if (exported.type === "Identifier") return exported.name;
  if (exported.type === "StringLiteral") return exported.value;
  return null;
}

/**
 * Build one consistent error that shows both valid ways to configure prerender.
 */
function invalidPrerenderError(filePath) {
  return new Error(
    `[Goribu] Invalid prerender export in "${filePath}". ` +
      `Use \`export const prerender = true\` to force an attempt or ` +
      `\`export const prerender = false\` to keep the route dynamic.`,
  );
}
