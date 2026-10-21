import { config } from "dotenv";
import { getMigrations } from "better-auth/db/migration";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { authOptions } from "../server/auth";
import { getDb, getPool } from "../server/db";
config({ path: ".env.local", quiet: true });
try {
  const auth = await getMigrations(authOptions());
  await auth.runMigrations();
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  console.log("Authentication and workout migrations applied.");
} finally {
  await getPool().end();
}
