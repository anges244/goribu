import { describe, expect, it } from "vitest";
import { parsePostgresUrl } from "../src/build/postgres/parse-postgres-url.js";

const source = "POSTGRES_URL in .env.production";
const parse = (value) => parsePostgresUrl(value, source);

describe("parsePostgresUrl", () => {
  it("parses both PostgreSQL schemes and applies the default port", () => {
    expect(parse("postgres://app:secret@db.example.com/myapp")).toEqual({
      scheme: "postgres",
      user: "app",
      password: "secret",
      host: "db.example.com",
      port: 5432,
      database: "myapp",
      parameters: [],
    });

    expect(
      parse("postgresql://app:secret@db.example.com:6432/myapp"),
    ).toMatchObject({ scheme: "postgresql", port: 6432 });
  });

  it("decodes reserved credential and database characters without changing query order", () => {
    const parsed = parse(
      "postgresql://user%40team:p%40ss%3Aword%2F100%25@[::1]:5433/my%2Fdb?sslmode=require&option=a&option=b",
    );

    expect(parsed).toEqual({
      scheme: "postgresql",
      user: "user@team",
      password: "p@ss:word/100%",
      host: "::1",
      port: 5433,
      database: "my/db",
      parameters: [
        ["sslmode", "require"],
        ["option", "a"],
        ["option", "b"],
      ],
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.parameters)).toBe(true);
    expect(parsed.parameters.every(Object.isFrozen)).toBe(true);
  });

  it.each([
    [undefined, `[Goribu] ${source} is not a usable PostgreSQL connection URL. Set it to postgres://user:password@host:5432/database.`],
    ["", /Set it to postgres:\/\/user:password@host:5432\/database/],
    [" postgres://app:secret@localhost/db", /leading or trailing whitespace/],
    ["https://app:secret@localhost/db", /"postgres:" or "postgresql:" scheme/],
    ["postgres://:secret@localhost/db", /Include the database user.*postgres:\/\/postgres:postgres@localhost:5432\/myapp\.\nA local Postgres without password authentication accepts any password/],
    ["postgres://app@localhost/db", /Include the database password.*postgres:\/\/postgres:postgres@localhost:5432\/myapp.*\nA local Postgres without password authentication accepts any password/],
    ["postgres://app:secret@/db", /usable PostgreSQL connection URL/],
    ["postgres://app:secret@localhost", /Include exactly one database name/],
    ["postgres://app:secret@localhost/one/two", /exactly one database name/],
    ["postgres://app:secret@localhost:0/db", /TCP port from 1 to 65535/],
    ["postgres://app:secret@localhost/db#section", /Remove the URL fragment/],
    ["postgres://app:p%ZZ@localhost/db", /percent-encoding in the password/],
  ])("rejects unusable URL %p with a repair instruction", (value, message) => {
    expect(() => parse(value)).toThrow(message);
  });

  it("does not echo credentials in parse errors", () => {
    const secret = "do-not-print-this";
    expect(() =>
      parse(`postgres://app:${secret}@localhost`),
    ).toThrowError(expect.not.objectContaining({ message: expect.stringContaining(secret) }));
  });
});
