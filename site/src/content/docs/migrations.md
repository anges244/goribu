---
title: Migrations
description: Numbered D1 schema history, drift checks, rollback safety, and production rollout order.
---

Goribu reads SQL history from `migrations/`. Commands use local D1 by default;
`--remote` always means the production database.

## One file shape

Create the next migration:

```sh
goribu migrate:new create posts
```

Then write the SQL below the comment header in `migrations/0001_create-posts.sql`:

```sql
-- create-posts
-- Migrations are forward-only; undo a change with a new migration.

CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

Names use four digits, an underscore, and a lowercase hyphen-separated slug.
The whole file is the migration. Files from before 0.9.4 with `-- migrate:up`
and `-- migrate:down` markers keep working; only the SQL between the markers
runs, and the down section never does.

Once a file has run anywhere, never edit, delete, or insert history before it.
Write a new forward migration instead.

## Apply and inspect

```sh
goribu migrate                  # apply every pending local migration
goribu migrate:status           # inspect local history without mutation
goribu migrate --remote         # apply every pending production migration
goribu migrate:status --remote  # inspect production without mutation
```

Goribu records names and checksums in `_goribu_migrations`. Each file's up SQL
and ledger insert execute in one D1 batch. A failed file records nothing, but a
later file failing does not undo earlier migrations that already completed.

Status reports three forms of drift: a modified applied file, a deleted applied
file, or a pending file sequenced before applied history. Status and `goribu
check` show drift as information; migration commands refuse to mutate until the
original files are restored or a new forward migration carries the change.

## Undo a change

Migrations are forward-only. Undo a schema change with a new migration, such as
`DROP TABLE posts;` or `ALTER TABLE posts DROP COLUMN subtitle;`. To start local
D1 over, stop `goribu dev`, delete `.wrangler/state/v3/d1`, and run
`goribu migrate` again.

## Local seeds

Put repeatable development data in `migrations/seed.sql`, then run:

```sh
goribu migrate:seed
```

Seeds do not enter migration history. `--remote` is rejected before SQL runs;
production data changes belong in reviewed migrations or application behavior.

## Deploy ordering is not a transaction

`goribu check` reads the real production ledger and reports applied, pending,
and drift state. If the database is missing, it reports every file pending.

`goribu deploy` creates a missing database, applies every pending migration, and
then uploads the Worker. If migration fails, the new Worker is not uploaded.
Cloudflare still cannot commit schema and Worker version in one transaction, and
the old Worker serves while deployment runs, so use expand and contract:

1. Add a backward-compatible expand migration; deploy applies it before the code
   that uses the expanded shape. Run `goribu migrate --remote` first when you
   deliberately want to advance schema earlier.
2. Let the deployed code use the expanded shape.
3. Later deploy code that no longer uses the old shape.
4. Only then add the destructive contract migration for the next deploy.

Do not leave expand and contract simultaneously pending: deploy and `migrate`
apply all pending files in order.

On a first deploy, one command creates D1, applies the initial migration, and only
then uploads the Worker. There is no schema-missing route window. There is no
`--no-migrations` deploy flag: pre-applying with `goribu migrate --remote`
already gives full timing control without allowing known pending schema to be
skipped.

**Next:** [KV](/docs/kv).
