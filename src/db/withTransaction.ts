import { pool } from "./pool";
import { PoolClient } from "pg";

// Runs `fn` inside a single Postgres transaction, automatically
// committing on success or rolling back on any thrown error (including
// errors your own validation code throws deliberately, e.g.
// "insufficient credits" -- see routes/tank.ts for that pattern).
//
// Every economy-mutating route should go through this rather than
// issuing loose queries against the shared pool, for one specific
// reason: without a transaction + row lock, two nearly-simultaneous
// requests from the same account (a double-tapped Buy button, or a
// deliberately-scripted double-request from a modified client trying to
// buy something twice with money for one purchase) could both read the
// same starting balance, both pass the "can afford it" check, and both
// deduct -- overdrawing the account. `SELECT ... FOR UPDATE` inside the
// transaction (see routes/tank.ts etc for the actual usage) makes the
// second request block until the first one's transaction commits, so it
// sees the already-updated balance instead of the stale one.
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Locks the profile row for the duration of the transaction (see
// withTransaction's comment above for why) and returns the raw row so
// callers can read whatever specific fields they need without a second
// round-trip. Throws if the account has no profile row, which shouldn't
// happen for a logged-in account but is checked anyway rather than
// assumed.
export async function lockProfileRow(client: PoolClient, accountId: number): Promise<any> {
  const result = await client.query(`SELECT * FROM profiles WHERE account_id = $1 FOR UPDATE`, [accountId]);
  if (result.rows.length === 0) {
    throw new Error(`No profile row for account ${accountId}`);
  }
  return result.rows[0];
}
