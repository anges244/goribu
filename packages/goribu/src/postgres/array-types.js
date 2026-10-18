import { Buffer } from "node:buffer";

const DIMENSIONS_PREFIX = /^(?:\[-?\d+:-?\d+\])+=/;
const IDENTITY = (value) => value;

// inferType() yields only these element OIDs (bool, bytea, int8,
// timestamptz) or falls back to 25 (text); fetch_types would map them to
// their array OIDs.
const ARRAY_OID_BY_INFERRED_ELEMENT = Object.freeze({
  16: 1000, 17: 1001, 20: 1016, 25: 1009, 1184: 1185,
});

/**
 * Deliberately use a Postgres.js internal so sql.array() works with fetch_types
 * disabled. The exact postgres version pin and registration test protect this
 * dependency; call this for every new client.
 */
export function enableSqlArray(sql) {
  const map = sql.options?.shared?.typeArrayMap;
  if (map === null || typeof map !== "object") {
    throw new Error(
      "[Goribu] Postgres.js no longer exposes options.shared.typeArrayMap, which Goribu fills so sql.array() works without fetch_types. This is a Goribu bug: report it with the installed postgres version.",
    );
  }
  Object.assign(map, ARRAY_OID_BY_INFERRED_ELEMENT);
}

/**
 * Parse PostgreSQL's text array format without sharing mutable state across requests.
 *
 * PostgreSQL supplies valid array text for a declared column type. The defensive errors
 * here avoid returning a subtly corrupted shape if a driver/server mismatch ever hands
 * Goribu malformed text; values are deliberately omitted from errors because rows may
 * contain private application data.
 */
export function parsePostgresArray(value, parseElement = IDENTITY, delimiter = ",") {
  if (typeof value !== "string") {
    throw malformedArray(
      "Expected the database driver to provide array text as a string.",
    );
  }
  if (typeof parseElement !== "function") {
    throw malformedArray("Expected a function for parsing array elements.");
  }
  if (typeof delimiter !== "string" || delimiter.length !== 1) {
    throw malformedArray("Expected the PostgreSQL array delimiter to be one character.");
  }

  const state = { value, index: 0, parseElement, delimiter };
  if (value.startsWith("[")) {
    const dimensions = DIMENSIONS_PREFIX.exec(value);
    if (dimensions === null) {
      throw malformedArray(
        "The array dimension prefix is invalid. Check the PostgreSQL server and driver versions.",
      );
    }
    state.index = dimensions[0].length;
  }

  const result = parseLevel(state);
  if (state.index !== value.length) {
    throw malformedArray(
      "Unexpected text followed the closing array brace. Check that the column keeps its declared built-in array type.",
    );
  }
  return result;
}

function parseLevel(state) {
  if (state.value[state.index] !== "{") {
    throw malformedArray(
      "An array level did not begin with `{`. Check that the result column is a PostgreSQL array.",
    );
  }
  state.index += 1;

  const result = [];
  if (state.value[state.index] === "}") {
    state.index += 1;
    return result;
  }

  while (state.index < state.value.length) {
    result.push(
      state.value[state.index] === "{" ? parseLevel(state) : parseElementValue(state),
    );

    const separator = state.value[state.index];
    if (separator === state.delimiter) {
      state.index += 1;
      continue;
    }
    if (separator === "}") {
      state.index += 1;
      return result;
    }

    throw malformedArray(
      "Expected an array delimiter or closing brace. Check the PostgreSQL array text returned by the driver.",
    );
  }

  throw malformedArray(
    "The array ended before its closing brace. Check the PostgreSQL array text returned by the driver.",
  );
}

function parseElementValue(state) {
  if (state.value[state.index] === '"') return parseQuotedElement(state);

  let element = "";
  let escaped = false;
  while (state.index < state.value.length) {
    const character = state.value[state.index];
    if (character === state.delimiter || character === "}") break;
    if (character === "{") {
      throw malformedArray(
        "A nested array began inside an unquoted element. Quote literal braces in text values.",
      );
    }
    if (character === "\\") {
      escaped = true;
      state.index += 1;
      if (state.index >= state.value.length) {
        throw malformedArray(
          "An array element ended after an escape character. Check the database value's escaping.",
        );
      }
      element += state.value[state.index];
      state.index += 1;
      continue;
    }

    element += character;
    state.index += 1;
  }

  if (element.length === 0) {
    throw malformedArray(
      "An array contains an empty unquoted element. PostgreSQL represents an empty string as `\"\"`.",
    );
  }
  if (!escaped && element === "NULL") return null;
  return applyElementParser(state.parseElement, element);
}

function parseQuotedElement(state) {
  state.index += 1;
  let element = "";

  while (state.index < state.value.length) {
    const character = state.value[state.index];
    if (character === "\\") {
      state.index += 1;
      if (state.index >= state.value.length) {
        throw malformedArray(
          "A quoted array element ended after an escape character. Check the database value's escaping.",
        );
      }
      element += state.value[state.index];
      state.index += 1;
      continue;
    }
    if (character === '"') {
      state.index += 1;
      return applyElementParser(state.parseElement, element);
    }

    element += character;
    state.index += 1;
  }

  throw malformedArray(
    "A quoted array element did not have a closing quote. Check the PostgreSQL array text returned by the driver.",
  );
}

function applyElementParser(parser, value) {
  try {
    return parser(value);
  } catch {
    // JSON.parse and user-provided element parsers can include the private value in
    // their error message. Do not retain the cause: production logs the full error.
    throw malformedArray(
      "An array element could not be parsed as its declared built-in PostgreSQL type.",
    );
  }
}

function malformedArray(instruction) {
  return new TypeError(
    `[Goribu] Could not parse a PostgreSQL array result. ${instruction}`,
  );
}

/** Serialize array parameters without a catalog lookup. */
export function serializePostgresArray(values, serializeElement, delimiter = ",") {
  if (!Array.isArray(values)) return values;
  return "{" + values.map((value) => {
    if (Array.isArray(value)) return serializePostgresArray(value, serializeElement, delimiter);
    if (value === null) return "NULL";
    if (value === undefined) {
      throw new TypeError(
        "[Goribu] An array parameter contains undefined. Use null for SQL NULL, or remove the element.",
      );
    }
    return '"' + serializeElement(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }).join(delimiter) + "}";
}

// Match Postgres.js's scalar codecs; int8 and numeric deliberately use TEXT.
const TEXT = { parse: IDENTITY, serialize: (value) => "" + value };
const NUMBER = { parse: (value) => +value, serialize: TEXT.serialize };
const BOOLEAN = { parse: (value) => value === "t", serialize: (value) => value === true ? "t" : "f" };
const DATE = {
  parse: (value) => new Date(value),
  serialize: (value) => (value instanceof Date ? value : new Date(value)).toISOString(),
};
const JSON_TYPE = { parse: JSON.parse, serialize: JSON.stringify };
const BYTEA = {
  parse: (value) => Buffer.from(value.slice(2), "hex"),
  serialize: (value) => "\\x" + Buffer.from(value).toString("hex"),
};

function arrayType(oid, element = TEXT, delimiter = ",") {
  return Object.freeze({
    to: oid,
    from: Object.freeze([oid]),
    parse(value) {
      return parsePostgresArray(value, element.parse, delimiter);
    },
    serialize(values) {
      return serializePostgresArray(values, element.serialize, delimiter);
    },
  });
}

/**
 * OIDs come from PostgreSQL 18's pg_type.dat and were verified against PG 18.6
 * on 2026-10-18:
 * https://github.com/postgres/postgres/blob/REL_18_STABLE/src/include/catalog/pg_type.dat
 *
 * Postgres.js installs these parsers and serializers even with fetch_types: false.
 * Enum, domain and extension arrays have per-database OIDs, so they stay text.
 */
export const POSTGRES_ARRAY_TYPES = Object.freeze({
  // Catalog and scalar types with fixed built-in OIDs.
  jsonArray: arrayType(199, JSON_TYPE),
  pgTypeArray: arrayType(210),
  pgAttributeArray: arrayType(270),
  xid8Array: arrayType(271),
  pgProcArray: arrayType(272),
  pgClassArray: arrayType(273),
  lineArray: arrayType(629),
  cidrArray: arrayType(651),
  circleArray: arrayType(719),
  macaddr8Array: arrayType(775),
  moneyArray: arrayType(791),
  boolArray: arrayType(1000, BOOLEAN),
  byteaArray: arrayType(1001, BYTEA),
  charArray: arrayType(1002),
  nameArray: arrayType(1003),
  int2Array: arrayType(1005, NUMBER),
  int2VectorArray: arrayType(1006),
  int4Array: arrayType(1007, NUMBER),
  regprocArray: arrayType(1008),
  textArray: arrayType(1009),
  tidArray: arrayType(1010),
  xidArray: arrayType(1011),
  cidArray: arrayType(1012),
  oidVectorArray: arrayType(1013),
  bpcharArray: arrayType(1014),
  varcharArray: arrayType(1015),
  int8Array: arrayType(1016),
  pointArray: arrayType(1017),
  lineSegmentArray: arrayType(1018),
  pathArray: arrayType(1019),
  boxArray: arrayType(1020, TEXT, ";"),
  float4Array: arrayType(1021, NUMBER),
  float8Array: arrayType(1022, NUMBER),
  polygonArray: arrayType(1027),
  oidArray: arrayType(1028, NUMBER),
  aclitemArray: arrayType(1034),
  macaddrArray: arrayType(1040),
  inetArray: arrayType(1041),
  timestampArray: arrayType(1115, DATE),
  dateArray: arrayType(1182, DATE),
  timeArray: arrayType(1183),
  timestamptzArray: arrayType(1185, DATE),
  intervalArray: arrayType(1187),
  numericArray: arrayType(1231),
  cstringArray: arrayType(1263),
  timetzArray: arrayType(1270),
  bitArray: arrayType(1561),
  varbitArray: arrayType(1563),
  refcursorArray: arrayType(2201),
  regprocedureArray: arrayType(2207),
  regoperArray: arrayType(2208),
  regoperatorArray: arrayType(2209),
  regclassArray: arrayType(2210),
  regtypeArray: arrayType(2211),
  recordArray: arrayType(2287),
  txidSnapshotArray: arrayType(2949),
  uuidArray: arrayType(2951),
  pgLsnArray: arrayType(3221),
  tsvectorArray: arrayType(3643),
  gtsvectorArray: arrayType(3644),
  tsqueryArray: arrayType(3645),
  regconfigArray: arrayType(3735),
  regdictionaryArray: arrayType(3770),
  jsonbArray: arrayType(3807, JSON_TYPE),
  int4RangeArray: arrayType(3905),
  numRangeArray: arrayType(3907),
  tsRangeArray: arrayType(3909),
  tstzRangeArray: arrayType(3911),
  dateRangeArray: arrayType(3913),
  int8RangeArray: arrayType(3927),
  regnamespaceArray: arrayType(4090),
  regroleArray: arrayType(4097),
  jsonpathArray: arrayType(4073),
  regcollationArray: arrayType(4192),
  pgSnapshotArray: arrayType(5039),
  int4MultiRangeArray: arrayType(6150),
  numMultiRangeArray: arrayType(6151),
  tsMultiRangeArray: arrayType(6152),
  tstzMultiRangeArray: arrayType(6153),
  dateMultiRangeArray: arrayType(6155),
  int8MultiRangeArray: arrayType(6157),
  xmlArray: arrayType(143),
});
