import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  // Fail loudly at startup rather than mysteriously later on the first
  // query -- a missing DATABASE_URL means the service is misconfigured
  // and shouldn't accept traffic at all.
  throw new Error("DATABASE_URL environment variable is not set.");
}

// Render's managed Postgres requires SSL, but its certificate isn't
// always in Node's default trust store depending on the plan/region, so
// `rejectUnauthorized: false` is the standard workaround Render's own
// docs recommend. Localhost (for local dev against a plain local
// Postgres) skips SSL entirely.
const useSsl = !connectionString.includes("localhost");

export const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});
