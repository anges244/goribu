import { Buffer } from "node:buffer";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POSTGRES_ARRAY_TYPES, enableSqlArray } from "../src/postgres/array-types.js";

describe.skipIf(!process.env.GORIBU_TEST_POSTGRES_URL)(
  "Postgres array types against a real database (set GORIBU_TEST_POSTGRES_URL to run)",
  () => {
    let sql;
    beforeAll(() => {
      sql = postgres(process.env.GORIBU_TEST_POSTGRES_URL, {
        max: 1, fetch_types: false, prepare: true,
        types: POSTGRES_ARRAY_TYPES, onnotice() {},
      });
      enableSqlArray(sql);
    });
    afterAll(async () => { await sql?.end(); });

    it("round-trips text containing delimiters, escaping, NULL, and unicode", async () => {
      const values = ['a,b', 'brace{x}', 'q"', 'back\\slash', 'NULL', '', ' spaced ', null, "Ελληνικά 🐘"];
      const [row] = await sql`select ${values}::text[] as v`;
      expect(row.v).toEqual(values);
    });

    it("round-trips multidimensional int4 and precision-safe int8 arrays", async () => {
      const matrix = [[1, 2], [3, null]];
      const big = ["9223372036854775807", "-9223372036854775808", null];
      const [row] = await sql`select ${matrix}::int4[] as matrix, ${big}::int8[] as big`;
      expect(row.matrix).toEqual(matrix);
      expect(row.big).toEqual(big);
    });

    it("round-trips booleans, timestamps, and dates with scalar-compatible values", async () => {
      const bools = [true, false, null];
      const timestamps = [new Date("2026-10-18T12:34:56Z"), null];
      const dates = ["2026-10-18", null];
      const [row] = await sql`select ${sql.array(bools)}::bool[] as bools, ${sql.array(timestamps)}::timestamptz[] as timestamps, ${dates}::date[] as dates`;
      expect(row.bools).toEqual(bools);
      expect(row.timestamps).toEqual(timestamps);
      expect(row.dates).toEqual([new Date("2026-10-18T00:00:00Z"), null]);
    });

    it("round-trips JSON objects, binary values, and UUIDs", async () => {
      const objects = [{ quote: '"', slash: "\\", nested: [1, 2] }, null];
      const bytes = [Buffer.from([0, 255]), Buffer.from([]), null];
      const uuids = ["00000000-0000-0000-0000-000000000000", null];
      const [row] = await sql`select ${objects}::jsonb[] as objects, ${sql.array(bytes)}::bytea[] as bytes, ${uuids}::uuid[] as uuids`;
      expect(row.objects).toEqual(objects);
      expect(row.bytes).toEqual(bytes);
      expect(row.uuids).toEqual(uuids);
    });

    it("supports sql.array for bigint, text, and number values", async () => {
      const big = [9223372036854775807n, -9223372036854775808n, null];
      const text = ["a", 'q"'];
      const numbers = [1, 2];
      const [row] = await sql`select ${sql.array(big)}::int8[] as big, ${sql.array(text)}::text[] as text, ${sql.array(numbers)}::int[] as numbers`;
      expect(row.big).toEqual(["9223372036854775807", "-9223372036854775808", null]);
      expect(row.text).toEqual(text);
      expect(row.numbers).toEqual(numbers);
    });

    it("uses the server's parameter type for ANY without a cast", async () => {
      const [row] = await sql`select 'b' = any(${["a", "b"]}) as found`;
      expect(row.found).toBe(true);
    });

    it("inserts plain arrays using the column types", async () => {
      await sql`create temp table t (tags text[], counts int4[])`;
      const tags = ["a,b", "NULL", null];
      const counts = [1, 2, null];
      await sql`insert into t (tags, counts) values (${tags}, ${counts})`;
      const [row] = await sql`select tags, counts from t`;
      expect(row).toEqual({ tags, counts });
    });
  },
);
