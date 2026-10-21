import { betterAuth } from "better-auth";
import { apiKey } from "@better-auth/api-key";
import { getPool } from "./db";
import { PostgresDialect, type PostgresPoolClient } from "kysely";
import type { PoolClient } from "pg";

export function authOptions(bootstrap = false) {
  if (!process.env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET is required");
  return {
    database: getPool(),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    trustedOrigins: process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL] : [],
    emailAndPassword: { enabled: true, disableSignUp: !bootstrap, minPasswordLength: 12 },
    session: { cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: "database" as const },
    plugins: [apiKey({ defaultPrefix: "workout_", enableMetadata: true, rateLimit: { enabled: true, maxRequests: 300, timeWindow: 60000 } })],
  };
}
let auth: ReturnType<typeof betterAuth<ReturnType<typeof authOptions>>> | undefined;
export function getAuth() {
  return auth ??= betterAuth(authOptions());
}
export function transactionAuth(client: PoolClient, bootstrap = false) {
  // The caller owns BEGIN/COMMIT. Neither Kysely nor Better Auth may release or
  // independently commit this connection.
  const dialect = new PostgresDialect({ pool: {
    options: {},
    connect: async () => ({
      query: client.query.bind(client) as PostgresPoolClient["query"],
      release: () => {},
    }),
    end: async () => {},
  } });
  return betterAuth({ ...authOptions(bootstrap), database: { dialect, type: "postgres", transaction: false } });
}
