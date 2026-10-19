# Migrations

Goribu keeps D1 and Postgres schema history in SQL files under `migrations/`.
Migration commands run against the local development database by default. Add
`--remote` only when you deliberately intend to inspect or change production.
`goribu deploy` applies pending production migrations after preparing the
database and before uploading the new Worker. The examples below use D1; the
file format and history rules are the same for Postgres, with the differences
listed under [Postgres](#postgres).

## Create a migration

Scaffold the next numbered file from the application directory:

```sh
goribu migrate:new create posts
```

This creates `migrations/0001_create-posts.sql` with a two-line comment header.
Write the SQL below it:

```sql
-- create-posts
-- Migrations are forward-only; undo a change with a new migration.

CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

A filename is a four-digit sequence, an underscore, and a lowercase
hyphen-separated slug. The whole file is the migration's SQL. Migrations are
forward-only: there is no rollback section and no rollback command. See
[Undo a change](#undo-a-change).

Migration files are ordered history. Once a migration has run anywhere, do not
edit, delete, or insert an earlier-numbered file. Create a new forward migration
for the correction.

### Files from before 0.9.4

Older files have `-- migrate:up` and `-- migrate:down` markers. They keep
working unchanged: Goribu runs only the SQL between the two markers and never
runs the down section. Leave these files as they are, down section included.
The checksum covers the whole file, so editing any part of an applied file
reports it as modified.

## Apply migrations

Apply every pending migration to local D1:

```sh
goribu migrate
```

Apply pending migrations to production ahead of a deploy when you deliberately
want to advance a backward-compatible schema first:

```sh
goribu migrate --remote
```

Goribu creates one `_goribu_migrations` tracking table and records each applied
filename with its checksum. A migration's SQL and tracking row run in one D1
batch: if any statement fails, its schema changes and ledger insert are rolled
back together. Each migration is its own batch; a later migration failing does
not undo earlier migrations that completed successfully.

A file that contains only comments, such as a fresh scaffold, is refused before
D1 is touched. Filling in an already recorded empty scaffold later would change
its checksum and make history untrustworthy.

## Inspect status

Inspect local status without changing the tracking table:

```sh
goribu migrate:status
```

Inspect production:

```sh
goribu migrate:status --remote
```

The command reports applied, pending, and drifted migrations. It first checks
whether `_goribu_migrations` exists; an absent table means nothing has been
applied and is not created as a side effect.

`goribu check` includes the same production status in its read-only deployment
plan. If the database does not exist yet, check reports every local migration as
pending and explains that deploy will create the database, apply those files,
and then upload the Worker.

Drift means the files can no longer prove the history D1 recorded:

- **modified** — an applied file's checksum changed;
- **missing** — a recorded migration file was deleted;
- **out-of-order** — a pending file is sequenced before an applied file.

Status and check report drift as information. `migrate` refuses to mutate until
the original files are restored from version control or a new forward migration
is used instead.

## Undo a change

Goribu has no rollback. Removing a schema change is itself a change, so it gets
its own migration, which runs locally and in production like any other:

```sh
goribu migrate:new drop posts-subtitle
```

```sql
-- drop-posts-subtitle
-- Migrations are forward-only; undo a change with a new migration.

DROP INDEX IF EXISTS posts_subtitle_idx;
ALTER TABLE posts DROP COLUMN subtitle;
```

- **Tables:** `DROP TABLE posts;` removes a table and its rows.
- **Columns on D1:** SQLite refuses to drop a column that is indexed, unique,
  part of the primary key, or used by a foreign key, view, or trigger. Drop the
  index or view first, as above, or rebuild the table.
- **Data you still need:** a drop destroys rows. On a live database, use
  [expand and contract](#deploy-ordering-is-not-a-transaction) so the deployed
  Worker stops using a column before a migration removes it.

To delete rows rather than schema, run SQL directly: `goribu d1 "DELETE FROM
posts WHERE …"` locally, or with `--remote`, which asks you to type the
database name first. For Postgres, use `psql`.

### Start the local database over

While you are still shaping a migration that has only run on your machine, you
can discard the local database and apply everything again. For D1, stop
`goribu dev`, then:

```sh
rm -rf .wrangler/state/v3/d1
goribu migrate
goribu migrate:seed   # if you have migrations/seed.sql
```

This deletes only local D1 data; local KV and R2 data are kept. For Postgres,
recreate your local database with `dropdb` and `createdb`, then run
`goribu migrate`. Never rewrite a migration that has run in production; add a
new one.

## Seed local data

Put repeatable development or test data in `migrations/seed.sql`, then run:

```sh
goribu migrate:seed
```

The seed file is executed against local D1 and never enters the migration
ledger. Write it so running it more than once has the result you intend. Seeds
are not production data changes: `migrate:seed --remote` is rejected at both the
CLI and runner boundaries, before configuration loads or SQL runs.

## Deploy ordering is not a transaction

There is no atomic boundary across a Worker deployment and a D1 migration.
`goribu deploy` orders the operations safely—build, provision D1, verify and
apply migrations, then upload—but Cloudflare cannot commit the schema and Worker
version as one unit. The previously deployed Worker continues serving while the
migrations and upload run.

If a migration fails, Goribu does not upload the new Worker. Each completed
migration file is still durable because files are separate D1 batches, and a
database created earlier in the deploy remains available for retry. Fix the SQL
or history and rerun `goribu deploy`.

For an existing production database, use expand and contract:

1. Add an **expand** migration that is compatible with the currently deployed
   Worker—for example, add a nullable column or a new table. `goribu deploy`
   applies it before uploading code that uses the expanded shape. You may instead
   run `goribu migrate --remote` earlier when you want time between those steps.
2. Let the deployed code use the expanded schema while remaining compatible
   with the old representation during the rollout.
3. In a later deploy, stop reading or writing the old column or table.
4. Only then add a **contract** migration that removes the old shape; the next
   deploy applies it before uploading that release.

Do not commit an expand and its destructive contract migration as simultaneously
pending files: deploy and `goribu migrate` both apply every pending migration in
order.

For the first deployment of a database-backed app, one `goribu deploy` creates
the missing database, applies its initial migration, and only then uploads the
Worker. There is no schema-missing Worker window.

There is deliberately no `goribu deploy --no-migrations` flag. When you need
full timing control, run `goribu migrate --remote` first; deploy still verifies
history before uploading and reports that it is already up to date. A bypass
would allow code to go live with known pending schema and would weaken the safe
default without enabling a workflow the explicit command cannot express.

## Postgres

Postgres apps use the same files, commands, tracking table, drift rules and
output. Write Postgres SQL:

```sql
-- create-posts
-- Migrations are forward-only; undo a change with a new migration.

CREATE TABLE posts (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`goribu migrate` and `goribu migrate:status` read `POSTGRES_MIGRATE_URL`, or
`POSTGRES_URL` when it is absent: from `.dev.vars`, or `.env` and `.env.local`,
locally, and from `.env.production` only with `--remote` and during deploy. See
[where connection strings live](./postgres.md#where-connection-strings-live).

### Direct connection and lock

Migrations connect straight to the database, never through Hyperdrive. A
migration run holds one connection for its whole duration and takes a Postgres
advisory lock on it, so two runs against the same database, such as two
deploys started together, apply migrations one after the other. The second run
prints that it is waiting, then finds nothing left to apply. Hyperdrive's
60-second statement limit does not apply, so a long index build or backfill can
run.

Each file and its tracking row commit in one transaction. If any statement
fails, Postgres rolls back the whole file and the error names the file and
Postgres's error code. Files applied earlier in the same run stay applied.
`migrate:status` never takes the lock and never creates the tracking table.

### Statements that cannot run in a transaction

Some statements, such as `CREATE INDEX CONCURRENTLY`, refuse to run inside a
transaction. Put such a statement alone in its own migration whose **first
line** is the directive:

```sql
-- goribu:no-transaction
-- add-posts-title-index

CREATE INDEX CONCURRENTLY IF NOT EXISTS posts_title_idx ON posts (title);
```

A no-transaction migration holds exactly one statement: Postgres runs several
statements sent together as one transaction, so a second statement fails with
error `25001`. The statement and its tracking row are separate steps, so write
it to be safe to repeat, for example with `IF NOT EXISTS`. A failed
`CREATE INDEX CONCURRENTLY` can leave an `INVALID` index that `IF NOT EXISTS`
would then skip; drop it with `DROP INDEX CONCURRENTLY IF EXISTS` before
retrying.

The directive is valid only on the first line and only for Postgres. Any other
line starting with `-- goribu:` is an error, and D1 refuses the directive.

### Not available for Postgres yet

`goribu migrate:seed` refuses to run on a Postgres app. Load development data
with `psql "$POSTGRES_URL" -f migrations/seed.sql`.
