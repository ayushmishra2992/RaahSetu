import { readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Resets TEST_DATABASE_URL (drops and recreates the `public` schema) and
 * applies every committed migration in order, so integration tests always
 * start from a fresh database built from the same SQL that `prisma migrate
 * deploy` applies. Skipped when TEST_DATABASE_URL is not configured.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn("\n[tests] TEST_DATABASE_URL is not set — integration tests will be SKIPPED.\n");
    return;
  }
  if (url === process.env.DATABASE_URL || /\/raahsetu(\?|$)/.test(url)) {
    throw new Error("TEST_DATABASE_URL must point to a dedicated test database (it is wiped).");
  }
  const migrationsDir = path.resolve("prisma/migrations");
  const migrations = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    for (const m of migrations) {
      const sql = readFileSync(path.join(migrationsDir, m, "migration.sql"), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${m} failed on the test database: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
  rmSync("./.test-uploads", { recursive: true, force: true });
  return () => rmSync("./.test-uploads", { recursive: true, force: true });
}
