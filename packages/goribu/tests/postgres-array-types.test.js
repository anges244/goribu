import { Buffer } from "node:buffer";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import {
  POSTGRES_ARRAY_TYPES,
  enableSqlArray,
  parsePostgresArray,
  serializePostgresArray,
} from "../src/postgres/array-types.js";

describe("serializePostgresArray", () => {
  it("round-trips escaped text, quoted NULL, whitespace, and SQL NULL", () => {
    const values = ['a,b', 'brace{x}', 'q"', 'back\\slash', 'NULL', '', ' spaced ', null];
    expect(parsePostgresArray(serializePostgresArray(values, (value) => "" + value))).toEqual(values);
  });

  it("serializes nested and empty arrays", () => {
    const values = [[1, 2], [3, null]];
    expect(POSTGRES_ARRAY_TYPES.int4Array.parse(POSTGRES_ARRAY_TYPES.int4Array.serialize(values))).toEqual(values);
    expect(serializePostgresArray([], String)).toBe("{}");
  });

  it("uses scalar-compatible boolean, date, JSON, and bytea serializers", () => {
    expect(POSTGRES_ARRAY_TYPES.boolArray.serialize([true, false, 1, null])).toBe('{"t","f","f",NULL}');
    const date = new Date("2026-10-18T12:34:56Z");
    expect(POSTGRES_ARRAY_TYPES.timestamptzArray.serialize([date])).toBe('{"2026-10-18T12:34:56.000Z"}');
    const objects = [{ quote: '"', slash: "\\", nested: [1, 2] }];
    expect(POSTGRES_ARRAY_TYPES.jsonbArray.parse(POSTGRES_ARRAY_TYPES.jsonbArray.serialize(objects))).toEqual(objects);
    const bytes = [Buffer.from([0, 255])];
    expect(POSTGRES_ARRAY_TYPES.byteaArray.serialize(bytes)).toBe(String.raw`{"\\x00ff"}`);
    expect(POSTGRES_ARRAY_TYPES.byteaArray.parse(POSTGRES_ARRAY_TYPES.byteaArray.serialize(bytes))).toEqual(bytes);
  });

  it("uses semicolons for box arrays in both directions", () => {
    const boxes = ["(1,1),(0,0)", "(3,3),(2,2)"];
    const serialized = POSTGRES_ARRAY_TYPES.boxArray.serialize(boxes);
    expect(serialized).toBe('{"(1,1),(0,0)";"(3,3),(2,2)"}');
    expect(POSTGRES_ARRAY_TYPES.boxArray.parse(serialized)).toEqual(boxes);
  });

  it("rejects undefined, including in a nested array", () => {
    for (const values of [[undefined], [[1, undefined]]]) {
      expect(() => serializePostgresArray(values, String)).toThrow(
        new TypeError("[Goribu] An array parameter contains undefined. Use null for SQL NULL, or remove the element."),
      );
    }
  });

  it("passes non-arrays through unchanged", () => {
    for (const value of ["{a,b}", null, 42]) {
      expect(serializePostgresArray(value, String)).toBe(value);
    }
  });
});

describe("parsePostgresArray", () => {
  it("distinguishes SQL NULL, quoted NULL, empty strings, and escaped text", () => {
    const value = String.raw`{"a,b","brace{value}","quote\"value","slash\\value",NULL,"NULL",""}`;

    expect(parsePostgresArray(value)).toEqual([
      "a,b",
      "brace{value}",
      'quote"value',
      "slash\\value",
      null,
      "NULL",
      "",
    ]);
  });

  it("parses nested and empty arrays without shared state", () => {
    const parseInteger = (value) => Number(value);

    expect(parsePostgresArray("{}", parseInteger)).toEqual([]);
    expect(parsePostgresArray("{{1,2},{3,NULL}}", parseInteger)).toEqual([
      [1, 2],
      [3, null],
    ]);
    expect(parsePostgresArray("[0:1]={4,5}", parseInteger)).toEqual([4, 5]);
    expect(parsePostgresArray("{6,7}", parseInteger)).toEqual([6, 7]);
  });

  it("supports PostgreSQL types with a non-comma array delimiter", () => {
    expect(parsePostgresArray("{one;two}", (value) => value, ";")).toEqual([
      "one",
      "two",
    ]);
  });

  it.each([
    [null, /provide array text as a string/],
    ["not-an-array", /did not begin with `\{`/],
    ["[0:1{a,b}", /dimension prefix is invalid/],
    ["{a,b", /Expected an array delimiter or closing brace/],
    ["{a,,b}", /empty unquoted element/],
    [String.raw`{"unfinished}`, /did not have a closing quote/],
    ['{"unfinished' + "\\", /ended after an escape character/],
    ["{a}trailing", /Unexpected text followed/],
  ])("rejects malformed array text without echoing it", (value, error) => {
    expect(() => parsePostgresArray(value)).toThrow(error);
  });

  it("does not expose malformed array or element values in the error chain", () => {
    const privateValue = "private-array-value";
    let structuralError;
    let elementError;

    try {
      parsePostgresArray(`{${privateValue}`);
    } catch (error) {
      structuralError = error;
    }
    try {
      POSTGRES_ARRAY_TYPES.jsonbArray.parse(`{"${privateValue}"}`);
    } catch (error) {
      elementError = error;
    }

    expect(structuralError).toBeInstanceOf(TypeError);
    expect(structuralError.message).not.toContain(privateValue);
    expect(elementError).toBeInstanceOf(TypeError);
    expect(elementError.message).not.toContain(privateValue);
    expect(elementError.cause).toBeUndefined();
  });
});

describe("POSTGRES_ARRAY_TYPES", () => {
  it("parses documented built-in arrays with scalar-compatible values", () => {
    expect(POSTGRES_ARRAY_TYPES.boolArray.parse("{t,f,NULL}")).toEqual([true, false, null]);
    expect(POSTGRES_ARRAY_TYPES.int4Array.parse("{{1,2},{3,4}}")).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(POSTGRES_ARRAY_TYPES.textArray.parse(String.raw`{"a,b","NULL",NULL}`)).toEqual([
      "a,b",
      "NULL",
      null,
    ]);
    expect(POSTGRES_ARRAY_TYPES.uuidArray.parse("{00000000-0000-0000-0000-000000000000}")).toEqual([
      "00000000-0000-0000-0000-000000000000",
    ]);
    expect(POSTGRES_ARRAY_TYPES.lineArray.parse(String.raw`{"{1,2,3}"}`)).toEqual([
      "{1,2,3}",
    ]);
    expect(POSTGRES_ARRAY_TYPES.circleArray.parse(String.raw`{"<(0,0),1>"}`)).toEqual([
      "<(0,0),1>",
    ]);
    expect(POSTGRES_ARRAY_TYPES.int4RangeArray.parse(String.raw`{"[1,5)",empty}`)).toEqual([
      "[1,5)",
      "empty",
    ]);
  });

  it("keeps int8 and numeric arrays as precision-safe strings", () => {
    expect(POSTGRES_ARRAY_TYPES.int8Array.parse("{9223372036854775807,-9223372036854775808}")).toEqual([
      "9223372036854775807",
      "-9223372036854775808",
    ]);
    expect(POSTGRES_ARRAY_TYPES.numericArray.parse("{1234567890.123456789,1e-1000}")).toEqual([
      "1234567890.123456789",
      "1e-1000",
    ]);
  });

  it("uses the matching Postgres.js parsers for dates, JSON, and bytea", () => {
    const [timestamp] = POSTGRES_ARRAY_TYPES.timestamptzArray.parse(
      '{"2026-08-30 12:34:56+00"}',
    );
    expect(timestamp).toBeInstanceOf(Date);
    expect(timestamp.toISOString()).toBe("2026-08-30T12:34:56.000Z");

    expect(
      POSTGRES_ARRAY_TYPES.jsonbArray.parse(
        String.raw`{"{\"name\":\"Goribu\"}","[1,2]",NULL}`,
      ),
    ).toEqual([{ name: "Goribu" }, [1, 2], null]);

    const [bytes] = POSTGRES_ARRAY_TYPES.byteaArray.parse(String.raw`{"\\x00ff10"}`);
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect([...bytes]).toEqual([0, 255, 16]);
  });

  it("installs static codecs and enables sql.array with fetch_types disabled", async () => {
    const sql = postgres("postgres://app:secret@localhost/myapp", {
      fetch_types: false,
      types: POSTGRES_ARRAY_TYPES,
    });

    try {
      enableSqlArray(sql);
      expect(sql.options.serializers[1000]).toBeTypeOf("function");
      expect(sql.options.parsers[1009]).toBeTypeOf("function");
      expect(sql.options.serializers[1009]).toBeTypeOf("function");
      expect(sql.options.parsers[1009](sql.options.serializers[1009](["a,b", null]))).toEqual(["a,b", null]);
    } finally {
      await sql.end({ timeout: 0 });
    }
  });

  it("explains when Postgres.js no longer exposes its array type map", () => {
    expect(() => enableSqlArray({ options: {} })).toThrow(
      new Error("[Goribu] Postgres.js no longer exposes options.shared.typeArrayMap, which Goribu fills so sql.array() works without fetch_types. This is a Goribu bug: report it with the installed postgres version."),
    );
  });
});
