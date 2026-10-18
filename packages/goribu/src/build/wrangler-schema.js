// Goribu's validator for Wrangler's shipped config-schema.json. It implements
// exactly the draft-07 keywords that schema uses and refuses any other keyword,
// type, or reference at compile time, so a schema it cannot fully enforce fails
// closed instead of passing configs it never checked.

const ANNOTATIONS = new Set([
  "$schema", "definitions", "description", "markdownDescription", "default", "examples", "deprecated", "allowTrailingCommas",
]);
const CONSTRAINTS = new Set(["type", "properties", "additionalProperties", "required", "items", "$ref", "const", "enum", "anyOf", "allOf"]);
const TYPES = {
  object: (value) => value !== null && typeof value === "object" && !Array.isArray(value),
  array: Array.isArray,
  string: (value) => typeof value === "string",
  number: (value) => typeof value === "number" && Number.isFinite(value),
  integer: Number.isInteger,
  boolean: (value) => typeof value === "boolean",
  null: (value) => value === null,
};
const REF_PREFIX = "#/definitions/";

/**
 * Compile the schema into a function returning structured errors, each with the
 * data `path` (an array of keys and indices) and a `keyword`. An empty array
 * means the value is valid. On one object, unknown fields are reported before
 * missing required fields, because a misspelled key causes both.
 */
export function compileWranglerSchema(root, wranglerVersion) {
  const definitions = root.definitions ?? {};
  const unsupported = (at, detail) => new Error(
    `[Goribu] Wrangler ${wranglerVersion}'s config schema ${detail} at ${at}, which Goribu cannot check. Update goribu, or remove wrangler from goribu.config.js until it supports this Wrangler.`,
  );

  (function check(node, at) {
    if (typeof node === "boolean") return;
    if (!TYPES.object(node)) throw unsupported(at, "contains a value that is not a schema");
    for (const key of Object.keys(node)) {
      if (!ANNOTATIONS.has(key) && !CONSTRAINTS.has(key)) throw unsupported(at, `uses the keyword ${JSON.stringify(key)}`);
    }
    if (node.$ref !== undefined && !(typeof node.$ref === "string" && node.$ref.startsWith(REF_PREFIX) &&
        Object.hasOwn(definitions, node.$ref.slice(REF_PREFIX.length)))) {
      throw unsupported(at, `has the unresolvable reference ${JSON.stringify(node.$ref)}`);
    }
    for (const type of [node.type ?? []].flat()) {
      if (!Object.hasOwn(TYPES, type)) throw unsupported(at, `uses the type ${JSON.stringify(type)}`);
    }
    for (const group of ["properties", "definitions"]) {
      for (const [name, child] of Object.entries(node[group] ?? {})) check(child, `${at}/${group}/${name}`);
    }
    if (node.items !== undefined) check(node.items, `${at}/items`);
    if (node.additionalProperties !== undefined) check(node.additionalProperties, `${at}/additionalProperties`);
    for (const group of ["anyOf", "allOf"]) (node[group] ?? []).forEach((child, index) => check(child, `${at}/${group}/${index}`));
  })(root, "#");

  function validate(node, value, path, errors) {
    if (node === true) return;
    if (node === false) return void errors.push({ path, keyword: "false" });
    if (node.$ref !== undefined) validate(definitions[node.$ref.slice(REF_PREFIX.length)], value, path, errors);
    if (node.type !== undefined) {
      const expected = [node.type].flat();
      if (!expected.some((type) => TYPES[type](value))) return void errors.push({ path, keyword: "type", expected });
    }
    if (Object.hasOwn(node, "const") && !jsonEqual(node.const, value)) errors.push({ path, keyword: "enum", allowed: [node.const] });
    if (node.enum !== undefined && !node.enum.some((allowed) => jsonEqual(allowed, value))) errors.push({ path, keyword: "enum", allowed: node.enum });
    if (TYPES.object(value)) {
      const known = node.properties ?? {};
      for (const key of Object.keys(value)) {
        if (Object.hasOwn(known, key) || node.additionalProperties === undefined) continue;
        if (node.additionalProperties === false) errors.push({ path, keyword: "additionalProperties", key });
        else validate(node.additionalProperties, value[key], [...path, key], errors);
      }
      for (const key of node.required ?? []) if (!Object.hasOwn(value, key)) errors.push({ path, keyword: "required", key });
      for (const [key, child] of Object.entries(known)) if (Object.hasOwn(value, key)) validate(child, value[key], [...path, key], errors);
    }
    if (Array.isArray(value) && node.items !== undefined) value.forEach((item, index) => validate(node.items, item, [...path, index], errors));
    for (const child of node.allOf ?? []) validate(child, value, path, errors);
    if (node.anyOf !== undefined) validateAnyOf(node.anyOf, value, path, errors);
  }

  // Report the branch the value most plausibly meant: one whose type matched,
  // with the fewest errors. When no branch's type matched, report the types.
  function validateAnyOf(branches, value, path, errors) {
    const attempts = [];
    for (const branch of branches) {
      const branchErrors = [];
      validate(branch, value, path, branchErrors);
      if (branchErrors.length === 0) return;
      attempts.push(branchErrors);
    }
    const typeMiss = (list) => list.length === 1 && list[0].keyword === "type" && list[0].path === path;
    const shaped = attempts.filter((list) => !typeMiss(list));
    if (shaped.length === 0) {
      return void errors.push({ path, keyword: "type", expected: [...new Set(attempts.flatMap((list) => list[0].expected))] });
    }
    errors.push(...shaped.reduce((best, list) => (list.length < best.length ? list : best)));
  }

  return (value) => {
    const errors = [];
    validate(root, value, [], errors);
    return errors;
  };
}

function jsonEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((item, index) => jsonEqual(item, b[index]));
  if (!TYPES.object(a) || !TYPES.object(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]));
}

/** Turn structured errors into one teaching [Goribu] message per problem. */
export function formatWranglerSchemaErrors(errors, wranglerVersion) {
  const at = (path) => path.reduce((text, part) => (typeof part === "number" ? `${text}[${part}]` : `${text}.${part}`), "wrangler");
  return [...new Set(errors.map((error) => {
    switch (error.keyword) {
      case "additionalProperties":
        return `[Goribu] ${at(error.path)} contains unknown field ${JSON.stringify(error.key)}. Check its spelling against Wrangler's configuration reference. ` +
          `This Goribu installation uses Wrangler ${wranglerVersion}; if the field needs a newer Wrangler, update goribu.`;
      case "required":
        return `[Goribu] ${at(error.path)} is missing required field ${JSON.stringify(error.key)}.`;
      case "type":
        return `[Goribu] ${at(error.path)} must be ${error.expected.join(" or ")}.`;
      case "enum":
        return `[Goribu] ${at(error.path)} must be ${error.allowed.map((value) => JSON.stringify(value)).join(" or ")}.`;
      default:
        return `[Goribu] ${at(error.path)} is not allowed.`;
    }
  }))];
}
