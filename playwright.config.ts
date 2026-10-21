import { defineConfig } from "@playwright/test";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  use: { baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000", headless: true, trace: "retain-on-failure" },
  reporter: "list",
});
