import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { createServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { goribu } from "goribu/vite";

const fixture = fileURLToPath(new URL("../../../fixtures/basic-app", import.meta.url));
const hyperdriveVariables = [
  "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_POSTGRES",
  "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_POSTGRES_CACHED",
];

describe.skipIf(!process.env.GORIBU_TEST_POSTGRES_URL)(
  "Postgres under goribu dev (set GORIBU_TEST_POSTGRES_URL to run)",
  () => {
    let table;
    let tableCreated = false;
    let direct;
    let root;
    let server;
    let base;
    let previousEnv;
    const tags = ["a", "b,c", "Ελληνικά"];

    beforeAll(async () => {
      table = `goribu_dev_${process.pid}_${Date.now()}`;
      const url = process.env.GORIBU_TEST_POSTGRES_URL;
      direct = postgres(url, { max: 1, onnotice() {} });
      await direct`create table ${direct(table)} (id int primary key, tags text[] not null)`;
      tableCreated = true;

      root = mkdtempSync(join(tmpdir(), "goribu-postgres-dev-"));
      cpSync(join(fixture, "src"), join(root, "src"), { recursive: true });
      for (const name of ["package.json", "goribu.config.js", "vite.config.js"]) {
        cpSync(join(fixture, name), join(root, name));
      }
      symlinkSync(join(fixture, "node_modules"), join(root, "node_modules"), "dir");
      const config = join(root, "goribu.config.js");
      writeFileSync(config, readFileSync(config, "utf8").replace("defineConfig({", 'defineConfig({\n  database: { type: "postgres" },'));
      // JSON quoting preserves URL characters through dotenv without logging it.
      writeFileSync(join(root, ".env"), `POSTGRES_URL=${JSON.stringify(url)}\n`);
      writeFileSync(join(root, "src/routes/postgres-rows.js"), `
const table = ${JSON.stringify(table)};
export async function POST(req, res) {
  const { id, tags } = await req.body();
  const sql = req.postgres;
  try {
    await sql\`insert into \${sql(table)} (id, tags) values (\${id}, \${tags})\`;
    return res.status(201).json({ id, tags });
  } catch (err) {
    return res.status(409).json({ code: err.code, constraint: err.constraint_name, name: err.name });
  }
}
export async function GET(req, res) {
  const sql = req.query.get("handle") === "cached" ? req.postgresCached : req.postgres;
  const [row] = await sql\`select id, tags from \${sql(table)} where id = \${Number(req.query.get("id"))}\`;
  return res.json(row);
}
`);
      writeFileSync(join(root, "src/routes/postgres-transaction.js"), `
const table = ${JSON.stringify(table)};
export async function POST(req, res) {
  const sql = req.postgres;
  try {
    await sql.begin(async (tx) => {
      await tx\`insert into \${tx(table)} (id, tags) values (2, \${["rolled back"]})\`;
      throw new Error("intentional rollback");
    });
  } catch (error) {
    if (error.message !== "intentional rollback") throw error;
  }
  await sql.begin(async (tx) => {
    await tx\`insert into \${tx(table)} (id, tags) values (3, \${["committed"]})\`;
  });
  const [row] = await sql\`select count(*)::int as count from \${sql(table)} where id in (2, 3)\`;
  return res.json(row);
}
`);
      writeFileSync(join(root, "src/routes/postgres-stream.js"), `
const table = ${JSON.stringify(table)};
export function GET(req, res) {
  return res.stream(new ReadableStream({
    async start(controller) {
      // Defer the query until after the handler has returned its Response.
      await new Promise((resolve) => setTimeout(resolve, 25));
      const sql = req.postgres;
      const [row] = await sql\`select tags from \${sql(table)} where id = \${Number(req.query.get("id"))}\`;
      controller.enqueue(new TextEncoder().encode(JSON.stringify(row.tags)));
      controller.close();
    },
  }));
}
`);
      previousEnv = Object.fromEntries(hyperdriveVariables.map((key) => [key, process.env[key]]));
      server = await createServer({
        root, cacheDir: join(root, ".vite-cache"), configFile: false,
        logLevel: "silent", plugins: [goribu()],
        server: { host: "127.0.0.1", port: 0 },
      });
      await server.listen();
      base = server.resolvedUrls.local[0];
    }, 60000);

    afterAll(async () => {
      const errors = [];
      const steps = [
        () => server?.close(),
        async () => { if (tableCreated) await direct`drop table ${direct(table)}`; },
        () => direct?.end({ timeout: 0 }),
        () => {
          for (const [key, value] of Object.entries(previousEnv ?? {})) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
        },
        () => { if (root) rmSync(root, { recursive: true, force: true }); },
      ];
      for (const step of steps) {
        try { await step(); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, "Postgres dev integration cleanup failed");
    }, 60000);

    function insert(id) {
      return fetch(new URL("/postgres-rows", base), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, tags }),
      });
    }

    it("round-trips arrays through both handles and preserves raw duplicate errors", async () => {
      const created = await insert(1);
      expect(created.status).toBe(201);
      expect(await created.json()).toEqual({ id: 1, tags });
      // Local Hyperdrive does not cache, so cached-read staleness needs a deployed Worker.
      for (const handle of ["fresh", "cached"]) {
        const response = await fetch(new URL(`/postgres-rows?id=1&handle=${handle}`, base));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ id: 1, tags });
      }
      const duplicate = await insert(1);
      expect(duplicate.status).toBe(409);
      expect(await duplicate.json()).toEqual({ code: "23505", constraint: `${table}_pkey`, name: "PostgresError" });
    }, 30000);

    it("rolls back a thrown transaction and commits a successful one", async () => {
      const response = await fetch(new URL("/postgres-transaction", base), { method: "POST" });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ count: 1 });
      expect(await direct`select id from ${direct(table)} where id in (2, 3)`).toEqual([{ id: 3 }]);
    }, 30000);

    it("queries in a stream after returning the Response", async () => {
      const created = await insert(4);
      expect(created.status).toBe(201);
      await created.json();
      const response = await fetch(new URL("/postgres-stream?id=4", base));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(JSON.stringify(tags));
    }, 30000);
  },
);
