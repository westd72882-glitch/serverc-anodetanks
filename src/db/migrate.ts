// One-shot migration: applies schema.sql to whatever DATABASE_URL points
// at. Safe to run multiple times -- every statement in schema.sql uses
// IF NOT EXISTS, so re-running this after the tables already exist is a
// no-op rather than an error.
//
// Run manually after your first deploy (see Render setup instructions):
//   npm run build && npm run migrate
// or, if you've SSH'd into the Render shell / running locally against the
// same DATABASE_URL, the same command works there too.

import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set -- nothing to migrate against.");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  });

  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");

  console.log("Applying schema.sql...");
  await pool.query(schema);
  console.log("Done. Tables are ready.");

  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
