import { TRACKING_TABLE } from "./read-migrations.js";
import { lastResultRows } from "./wrangler-d1.js";

const TABLE_EXISTS =
  `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${TRACKING_TABLE}'`;
const SELECT_APPLIED = `SELECT name, checksum FROM ${TRACKING_TABLE} ORDER BY name`;

/**
 * Read the applied-migration ledger without ever creating the tracking table.
 *
 * The canonical read-only path shared by every inspector (`migrate:status`, `goribu
 * check`): it asks `sqlite_master` whether the table exists first, so a missing table
 * reads as "nothing applied yet" rather than a side effect. A malformed or unreadable
 * result still fails closed inside `execute`, because treating a lost ledger as empty
 * would replay already-applied migrations.
 *
 * @param {{ execute: Function, shared: object }} options
 * @returns {Promise<Array<{ name: string, checksum: string }>>}
 */
export async function readAppliedMigrations({ execute, shared }) {
  const existence = await execute({ ...shared, command: TABLE_EXISTS, json: true });
  if (lastResultRows(existence).length === 0) return [];

  const appliedResult = await execute({ ...shared, command: SELECT_APPLIED, json: true });
  return lastResultRows(appliedResult).map((row) => ({
    name: String(row.name),
    checksum: String(row.checksum),
  }));
}
