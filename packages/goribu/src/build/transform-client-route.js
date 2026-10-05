import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import MagicString from "magic-string";
import { HANDLER_METHODS } from "../routing/handler-methods.js";

const traverse = traverseModule.default ?? traverseModule;
const SERVER_EXPORTS = new Set([...HANDLER_METHODS, "meta", "prerender", "uploads"]);
const SERVER_FILE = /\.server\.(?:[cm]?js|jsx|[cm]?ts|tsx)(?:[?#]|$)/i;

/**
 * Remove the server half of a route before Vite follows browser imports.
 *
 * Each top-level declaration/import specifier is a graph node. Babel's lexical
 * bindings connect references to declarations (including JSX and shadowing).
 * Only nodes reachable exclusively from server exports are removed. Unrelated
 * statements and side effects remain roots; this is not general tree-shaking.
 */
export function transformClientRoute(source, id) {
  const plugins = /\.[cm]?ts$/.test(id) ? ["typescript"]
    : /\.tsx$/.test(id) ? ["typescript", "jsx"] : ["jsx"];
  const ast = parse(source, { sourceType: "module", sourceFilename: id, plugins });
  let program;
  traverse(ast, { Program(path) { program = path; path.stop(); } });

  const units = new Map();
  const groups = [];
  const serverExports = [];
  function unit(path, server = false, client = false) {
    const value = { path, server, client, dependencies: new Set() };
    units.set(path.node, value);
    return value;
  }
  const nameOf = (node) => node.name ?? node.value;
  for (const statement of program.get("body")) {
    if (statement.isExportAllDeclaration() && statement.node.exportKind !== "type") {
      throw new Error(`[Goribu] Cannot separate browser and server exports in route ${JSON.stringify(id)} because it uses export *. Replace the wildcard with explicit named re-exports for handlers and browser helpers.`);
    }
    if (statement.isImportDeclaration()) {
      const items = statement.get("specifiers");
      for (const item of items) unit(item, SERVER_FILE.test(statement.node.source.value));
      if (items.length) groups.push({ kind: "import", statement, items });
      continue;
    }
    const named = statement.isExportNamedDeclaration();
    const declaration = named ? statement.get("declaration") : statement;
    if (named && !declaration.node) {
      const items = statement.get("specifiers");
      for (const item of items) {
        const server = SERVER_EXPORTS.has(nameOf(item.node.exported));
        unit(item, server, !server);
      }
      groups.push({ kind: "export", statement, items });
      continue;
    }
    const items = declaration.isVariableDeclaration()
      ? declaration.get("declarations") : [declaration];
    const clientNames = [];
    let hasServerExport = false;
    for (const item of items) {
      const names = Object.keys(item.getOuterBindingIdentifiers());
      const server = named && names.some((name) => SERVER_EXPORTS.has(name));
      const client = named && names.some((name) => !SERVER_EXPORTS.has(name));
      hasServerExport ||= server;
      clientNames.push(...names.filter((name) => !SERVER_EXPORTS.has(name)));
      const sideEffectRoot = !item.isDeclaration() && !item.isVariableDeclarator();
      unit(item, server, client || statement.isExportDefaultDeclaration() || sideEffectRoot);
    }
    groups.push({ kind: "declaration", statement, declaration, items });
    if (hasServerExport) serverExports.push({ statement, declaration, clientNames });
  }

  function owner(path) {
    for (let current = path; current && current !== program; current = current.parentPath) {
      if (units.has(current.node)) return units.get(current.node);
    }
    return null;
  }
  for (const binding of Object.values(program.scope.bindings)) {
    const target = owner(binding.path);
    if (!target) continue;
    for (const reference of [...binding.referencePaths, ...binding.constantViolations]) {
      // Babel counts an exported declaration as a reference to its own binding.
      // Its root status was classified above; aliases have their own units.
      if (reference.isExportNamedDeclaration() && reference.node.declaration) continue;
      const from = owner(reference);
      if (from) from.dependencies.add(target);
      else target.client = true;
    }
  }
  function reachable(roots) {
    const visited = new Set();
    function visit(value) {
      if (visited.has(value)) return;
      visited.add(value);
      for (const dependency of value.dependencies) visit(dependency);
    }
    for (const root of roots) visit(root);
    return visited;
  }
  const all = [...units.values()];
  const candidates = reachable(all.filter((value) => value.server));
  const live = reachable(all.filter((value) => value.client || !candidates.has(value)));
  const removed = new Set(all.filter((value) => !live.has(value)).map((value) => value.path.node));
  if (!removed.size && !serverExports.length) return null;
  // A direct eval can reference lexical bindings without an Identifier node.
  // Do not guess which server declarations its string will use in the browser.
  program.traverse({ CallExpression(path) {
    if (path.get("callee").isIdentifier({ name: "eval" }) && !path.scope.getBinding("eval") && live.has(owner(path))) {
      throw new Error(`[Goribu] Cannot safely separate server code in route ${JSON.stringify(id)} because browser code uses direct eval. Replace eval with explicit references, or move server-only evaluation into a .server module used by a handler.`);
    }
  } });

  const code = new MagicString(source);
  // Dev source maps must not republish the source that was just removed. Keep
  // its original line/column positions as whitespace for useful mapped errors.
  const redacted = new MagicString(source);
  function replace(start, end, text = "") {
    code.overwrite(start, end, text);
    redacted.overwrite(start, end, source.slice(start, end).replace(/[^\r\n]/g, " "));
  }
  for (const group of groups) {
    const { statement, items, kind } = group;
    const kept = items.filter((item) => !removed.has(item.node));
    if (kept.length === items.length) continue;
    if (!kept.length) {
      replace(statement.node.start, statement.node.end);
    } else if (kind === "import") {
      const defaults = kept.filter((item) => item.isImportDefaultSpecifier());
      const namespaces = kept.filter((item) => item.isImportNamespaceSpecifier());
      const named = kept.filter((item) => item.isImportSpecifier());
      const fragments = [...defaults, ...namespaces].map((item) => source.slice(item.node.start, item.node.end));
      if (named.length) fragments.push(`{ ${named.map((item) => source.slice(item.node.start, item.node.end)).join(", ")} }`);
      const suffix = source.slice(statement.node.source.start, statement.node.end);
      replace(statement.node.start, statement.node.end,
        `import ${statement.node.importKind === "type" ? "type " : ""}${fragments.join(", ")} from ${suffix}`);
    } else {
      // Delete whole runs with the following comma, or the preceding comma for
      // a trailing run. Retained declarations keep their original source maps.
      for (let i = 0; i < items.length;) {
        if (!removed.has(items[i].node)) { i++; continue; }
        const start = i;
        while (i < items.length && removed.has(items[i].node)) i++;
        if (i < items.length) replace(items[start].node.start, items[i].node.start);
        else replace(items[start - 1].node.end, items[i - 1].node.end);
      }
    }
  }
  for (const { statement, declaration, clientNames } of serverExports) {
    const group = groups.find((value) => value.statement === statement);
    if (group.items.every((item) => removed.has(item.node))) continue;
    replace(statement.node.start, declaration.node.start);
    if (clientNames.length) code.appendLeft(statement.node.end, `\nexport { ${clientNames.join(", ")} };`);
  }
  const map = code.generateMap({ source: id, hires: true });
  map.sourcesContent = [redacted.toString()];
  return { code: code.toString(), map };
}
