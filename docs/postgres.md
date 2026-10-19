# Postgres

Goribu connects a Worker to your own Postgres database through Cloudflare
[Hyperdrive](https://developers.cloudflare.com/hyperdrive/). Handlers get two
plain [Postgres.js](https://github.com/porsager/postgres) clients:
`req.postgres` for writes and fresh reads, and `req.postgresCached` for reads
that may be briefly stale. There is no wrapper, so the Postgres.js
documentation applies unchanged.

## Add Postgres in 3 steps

1. Declare the database in `goribu.config.js`:

   ```js
   import { defineConfig } from "goribu/server";

   export default defineConfig({
     name: "my-app",
     compatibilityDate: "2026-09-03",
     database: { type: "postgres" },
   });
   ```

2. Put the connection strings in env files, never in `goribu.config.js`:

   ```dotenv
   # .env — your local or development database
   POSTGRES_URL=postgres://postgres:postgres@localhost:5432/myapp

   # .env.production — your provider's direct (non-pooled) connection string
   POSTGRES_URL=postgres://app:secret@db.example.com:5432/myapp?sslmode=require
   ```

3. Write a migration, apply it locally, and deploy:

   ```sh
   goribu migrate:new create posts   # write the SQL in migrations/0001_create-posts.sql
   goribu migrate                    # apply it to the database in .env
   goribu dev                        # req.postgres now reaches that database
   goribu deploy                     # Hyperdrive, migrations, then the Worker
   ```

The first `goribu deploy` creates two Hyperdrive configs, applies pending
migrations directly to the production database, and only then uploads the
Worker. Later deploys update the configs from the current `POSTGRES_URL`, so a
password change is a matter of editing `.env.production` and deploying again.

Both values must include a user and a password. A local Postgres that does not
check passwords accepts any password, for example
`postgres://postgres:postgres@localhost:5432/myapp`. Postgres apps need a
`compatibilityDate` of `2024-09-23` or later; Goribu adds the `nodejs_compat`
flag that Postgres.js needs.

## Choosing a handle

Both handles are Postgres.js `sql` instances. The only difference is freshness.

| Handle | Binding | Hyperdrive caching | Use for |
| --- | --- | --- | --- |
| `req.postgres` | `POSTGRES` | Disabled | Writes, transactions, auth, sessions, permissions, billing, any read after a write, and anything when unsure |
| `req.postgresCached` | `POSTGRES_CACHED` | Enabled: 60 s max age plus 15 s stale-while-revalidate | Public pages, lists, catalogs, search, dashboards |

Hyperdrive never invalidates cached reads when you write. A row written through
`req.postgres` can take about 75 seconds to appear through `req.postgresCached`
(a live check measured 77 seconds). That delay is why the split exists and why
the fresh handle is the default.

```js
export async function GET(req, res) {
  // Fresh read: this page must reflect the latest write.
  const [poll] = await req.postgres`SELECT id, title FROM polls WHERE id = ${req.params.id}`;
  if (!poll) return res.notFound();

  // Cached read: fine if a new poll appears a minute late.
  const recent = await req.postgresCached`
    SELECT id, title FROM polls ORDER BY id DESC LIMIT 20`;

  return res.json({ poll, recent });
}

export async function POST(req, res) {
  const { title } = await req.body();
  // Writes and transactions always use req.postgres.
  await req.postgres.begin(async (sql) => {
    const [{ id }] = await sql`INSERT INTO polls (title) VALUES (${title}) RETURNING id`;
    await sql`INSERT INTO options (poll_id, text) VALUES (${id}, 'Yes'), (${id}, 'No')`;
  });
  return res.redirect("/polls");
}
```

Caching is invisible during development: `goribu dev` connects both handles
straight to your local database, so `req.postgresCached` always returns fresh
data there. A wrong choice of handle only shows up in production.

## The rules

These rules apply to every Postgres app. Each one is a check a reviewer or a
coding agent can apply to a change.

1. Use `req.postgres` unless the read is public or a listing and may be a minute stale.
2. Never write or open a transaction on `req.postgresCached`.
3. Build SQL only with tagged templates. `sql.unsafe` is for trusted, static SQL only.
4. In cached queries, avoid `NOW()`, `CURRENT_DATE` and `RANDOM()`. Compute the value in JS and pass it as a parameter; otherwise the query is never cached.
5. Never call `.end()`.
6. Change schema only by adding a migration. Never edit an applied one.
7. Renames, type changes and drops use expand and contract across two deploys.
8. Keep no session state: `SET` only inside a transaction; no `LISTEN`/`NOTIFY` or temp tables.
9. Handle constraint violations by `err.code`, not by message text.

## Queries

Interpolated values in a tagged template become bound parameters, never SQL
text. Use Postgres.js helpers such as `sql(identifier)` and `sql(rows)` for
dynamic identifiers and bulk inserts.

- **Lifecycle.** Each handle is created on first use, once per request. Goribu
  never ends it, and neither should you: Hyperdrive pools the real database
  connections. Queries inside a `res.stream()` body keep working after the
  response is returned.
- **Connections.** A Worker request can hold six outbound connections at once.
  `req.postgres` opens at most three and `req.postgresCached` at most two,
  leaving one for `fetch()`. Sequential queries share one connection;
  `Promise.all` uses more, up to that limit, and queues the rest.
- **Prepared statements** stay on, the Postgres.js default. Hyperdrive's caching
  relies on them.
- **Transactions.** `req.postgres.begin(async (sql) => { … })` commits when the
  callback resolves and rolls back when it throws.
- **Pooling is per transaction.** Hyperdrive reuses database connections between
  queries, so `SET`, session advisory locks, temporary tables and
  `LISTEN`/`NOTIFY` do not survive from one query to the next.
- **Placement.** Each uncached query is a round trip from the Worker's location
  to the database. When a request runs several in sequence, running the Worker
  near the database with [`placement`](wrangler.md#placement) shortens all of
  them.

### Types

Built-in scalar types parse as usual. Arrays of built-in types are parsed too:
pass JavaScript string and number arrays directly as parameters, and wrap
boolean, `Date`, `bytea` or `bigint` arrays in `sql.array()`, as Postgres.js
documents. `int8[]` and `numeric[]` come back as arrays of strings, so no
precision is lost. Arrays of enum or domain types come back as their text form
(`'{a,b}'`), because Goribu does not look up custom types at startup.

### Errors

Query errors are the raw Postgres.js `PostgresError`, carrying Postgres's own
`code`:

```js
try {
  await req.postgres`INSERT INTO users (email) VALUES (${email})`;
} catch (err) {
  if (err.code === "23505") return res.status(409).json({ error: "Email already registered" });
  throw err;
}
```

Common codes are `23505` (unique violation), `23503` (foreign key violation)
and `42P01` (missing table, usually a migration that has not run). An error you
do not catch reaches the [request error boundary](./errors.md) like any other
throw.

Using either handle in an app without `database: { type: "postgres" }` throws
immediately with the configuration to add, so a misconfigured app or test never
silently skips a query.

### Custom clients

`req.env.POSTGRES.connectionString` and `req.env.POSTGRES_CACHED.connectionString`
are the Hyperdrive connection strings, in development and in production. Use
them to build another client, such as a different driver; its lifecycle and
limits are then yours.

`req.env.POSTGRES_URL` also exists under `goribu dev`, because Cloudflare loads
`.env` into the local Worker. It does not exist in production, so never read it
from application code.

## Migrations

Postgres uses the same migration files and commands as D1: numbered
`migrations/0001_name.sql` files of forward-only SQL, and `goribu migrate`,
`goribu migrate:status` and
`goribu migrate:new`. Each runs locally by default and against production with
`--remote`.

Migrations connect directly to the database, never through Hyperdrive. Each
file runs in its own transaction, and a lock keeps two runs from migrating the
same database at once. A file that starts with `-- goribu:no-transaction` runs
outside a transaction, for statements such as `CREATE INDEX CONCURRENTLY`.
See [Migrations](./migrations.md#postgres) for the details.

`migrate:seed` is not available for Postgres yet; load development data with
`psql "$POSTGRES_URL" -f migrations/seed.sql`. Use `psql "$POSTGRES_URL"` where
D1 apps use `goribu d1`. To start your local database over, recreate it with
`dropdb` and `createdb`, then run `goribu migrate`.

## Where connection strings live

Goribu reads exactly two keys, `POSTGRES_URL` and the optional
`POSTGRES_MIGRATE_URL`, and nothing else from these files:

| Command | Reads |
| --- | --- |
| `goribu dev`, `goribu migrate`, `goribu migrate:status` | `.dev.vars` if it exists; otherwise `.env`, with `.env.local` overriding it |
| `goribu deploy`, `goribu migrate --remote`, `goribu migrate:status --remote` | `.env.production` only, never falling back to local files |

`POSTGRES_URL` is the connection the Worker uses. `POSTGRES_MIGRATE_URL`, when
set, is used for migrations instead: give it a role that can change schema
when the Worker's role cannot.

Neither value ever reaches the deployed Worker. Deploy removes both keys from the
`.env.production` upload before Wrangler sees it, and uploads the remaining
entries as secrets as usual. The connection string lives only in the
Hyperdrive configs, where Cloudflare stores the password and never returns it.
If an earlier deploy did upload one of these keys as a Worker secret, deploy
prints the `goribu wrangler secret delete` command that removes it. Goribu
never deletes secrets itself.

Values are read literally: `${OTHER}` is not expanded. Quote a value that
contains `#`, which otherwise starts a comment.

## What deploy does

For a Postgres app, `goribu deploy`:

1. Reads `POSTGRES_URL` from `.env.production` and stops before any change if it
   is missing or invalid.
2. Checks Cloudflare credentials, builds, and validates the remaining production
   secrets.
3. Creates or updates two Hyperdrive configs, `<name>-postgres` (caching
   disabled) and `<name>-postgres-cached` (caching enabled). It finds them by
   exact name and stops if a name matches more than one config. Every deploy
   sends the current origin and caching mode, so a changed password or a config
   edited in the dashboard is repaired. Cloudflare checks the connection before
   saving, so a wrong password stops the deploy and leaves the live configs
   untouched.
4. Applies pending migrations directly to the database.
5. Uploads the Worker with the `POSTGRES` and `POSTGRES_CACHED` bindings.

If any step before the upload fails, nothing is uploaded and the previous Worker
keeps serving. Rerunning `goribu deploy` is safe.

- **Use a direct connection string.** A host containing `-pooler`, or port 6543
  or 6432, prints a warning: Hyperdrive already pools connections, and a second
  pooler in front of the database can break prepared statements and the
  migration lock.
- **TLS.** Add `?sslmode=require` to require TLS between Hyperdrive and the
  database. Other `sslmode` values stop the deploy: `verify-ca` and
  `verify-full` need a CA certificate uploaded to Cloudflare, which you configure
  yourself as described in [Private databases](#private-database-on-a-vps).
- **Permissions.** Wrangler's login can manage Hyperdrive. An API token needs
  Hyperdrive edit permission in addition to the Workers permissions.
- **No Hyperdrive in Wrangler files.** Goribu owns both bindings. A `hyperdrive`
  entry in your own `wrangler.*` file fails the build with instructions to
  remove it.

`goribu check` does not inspect Postgres yet. For a Postgres app it says so and
describes what deploy will do.

## Limits

Check Cloudflare's [pricing](https://developers.cloudflare.com/hyperdrive/platform/pricing/)
and [limits](https://developers.cloudflare.com/hyperdrive/platform/limits/)
pages for current numbers. At the time of writing:

- **Queries.** The Workers Free plan allows 100,000 Hyperdrive queries per day,
  cached or not, reset at 00:00 UTC. Paid plans have no daily cap.
- **Configs.** Each Postgres app uses two Hyperdrive configs. A Free account can
  have 10 and a Paid account 25.
- **Database connections.** Each config opens up to about 20 connections to your
  database on Free and about 100 on Paid. Two configs mean two pools, so size
  the database's connection limit for both, plus migrations.
- **Statement time.** A query through Hyperdrive can run for at most 60 seconds.
  Migrations connect directly and are not subject to this limit.

## Provider recipes

Every provider works the same way: give Goribu the direct connection string,
not the provider's pooler. Each recipe ends with `goribu deploy`.

### Neon

1. In the Neon console, open **Connect**, turn off **Connection pooling**, and
   copy the connection string. Its host must not contain `-pooler`.
2. Put it in `.env.production` as `POSTGRES_URL`. Keep `sslmode=require`; other
   parameters such as `channel_binding` are ignored.
3. Optionally put a Neon development branch's string in `.env` for local work.
4. Run `goribu deploy`.

The same string works for migrations, so `POSTGRES_MIGRATE_URL` is not needed.

### PlanetScale Postgres

Give the Worker a role that can read and write data but not change schema, and
let migrations use the default role. Create the application role as the default
role:

```sql
CREATE ROLE app_user LOGIN PASSWORD 'choose-a-strong-password';
GRANT pg_read_all_data, pg_write_all_data TO app_user;
```

Then, in `.env.production`:

```dotenv
POSTGRES_URL=postgres://app_user:…@<host>:5432/<database>?sslmode=require
POSTGRES_MIGRATE_URL=postgres://<default role>:…@<host>:5432/<database>?sslmode=require
```

Use port 5432 (the direct connection), not 6432 (PgBouncer). Run `goribu deploy`:
the Worker connects as `app_user`, and migrations run as the default role.

### Public database on a VPS

1. Enable TLS in Postgres and allow connections from the internet, or at least
   from Cloudflare's IP ranges, in `pg_hba.conf` and your firewall.
2. Put `postgres://<user>:<password>@<host>:5432/<database>?sslmode=require` in
   `.env.production`. A self-signed certificate works with `sslmode=require`,
   which encrypts without verifying the certificate.
3. Run `goribu deploy`.

### Private database on a VPS

Hyperdrive can reach a database with no public address through a Cloudflare
Tunnel or Workers VPC. Goribu does not automate that network setup:

1. Follow Cloudflare's guide to
   [connect Hyperdrive to a private database](https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database-vpc/),
   and create **two** Hyperdrive configs: one with caching disabled and one with
   caching enabled.
2. Add their IDs to `goribu.config.js`:

   ```js
   database: {
     type: "postgres",
     hyperdriveId: "<id of the caching-disabled config>",
     hyperdriveCachedId: "<id of the caching-enabled config>",
   },
   ```

3. Still put `POSTGRES_URL` (or `POSTGRES_MIGRATE_URL`) in `.env.production`,
   as the database is seen from the machine you deploy from: migrations connect
   to it directly.
4. Run `goribu deploy` from a machine that can reach the database.

With your own IDs, deploy checks that the first config has caching disabled and
the second enabled, and stops otherwise. It never changes their origins.

## Not yet

These are deliberate omissions, not oversights:

- `migrate:seed` for Postgres;
- a Postgres version of `goribu d1` (use `psql "$POSTGRES_URL"`);
- Postgres inspection in `goribu check`;
- D1 and Postgres in the same app (an app declares one `database`).

Out of scope: an ORM or query builder, typed rows or code generation, read
replicas, provisioning the database itself, JavaScript migrations, and
`LISTEN`/`NOTIFY`.
