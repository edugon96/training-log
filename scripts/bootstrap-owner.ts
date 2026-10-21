import { config } from "dotenv";
import { z } from "zod";
import { transactionAuth } from "../server/auth";
import { getPool, withTransaction } from "../server/db";
config({ path: ".env.local", quiet: true });
const input = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  name: z.string().min(1),
}).parse({ email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD, name: process.env.OWNER_NAME || "Owner" });
try {
  await withTransaction(async (_db, client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('workout_owner_bootstrap', 0))");
    const existing = await client.query('SELECT id FROM "user" LIMIT 1');
    if (existing.rowCount) {
      console.log("An owner already exists. No account changed.");
    } else {
      await transactionAuth(client, true).api.signUpEmail({ body: input });
      console.log("Owner account created. Public registration remains disabled.");
    }
  });
} finally {
  await getPool().end();
}
