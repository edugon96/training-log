import { randomBytes } from "node:crypto";
import { access, writeFile, mkdir } from "node:fs/promises";

try {
  await access(".env.local");
  console.log("Existing .env.local preserved.");
} catch {
  const password = randomBytes(24).toString("base64url");
  const email = process.env.OWNER_EMAIL || "owner@example.test";
  await writeFile(".env.local", [
    "DATABASE_URL=postgresql://workout:localdev@localhost:55432/workout",
    "BETTER_AUTH_URL=http://localhost:3000",
    `BETTER_AUTH_SECRET=${randomBytes(48).toString("base64url")}`,
    `OWNER_EMAIL=${email}`,
    `OWNER_NAME=${process.env.OWNER_NAME || "Owner"}`,
    `OWNER_PASSWORD=${password}`,
    "",
  ].join("\n"), { mode: 0o600, flag: "wx" });
  await mkdir(".local", { recursive: true, mode: 0o700 });
  await writeFile(".local/login.txt", `Local prototype login\nURL: http://localhost:3000\nEmail: ${email}\nPassword: ${password}\n`, { mode: 0o600, flag: "wx" });
  console.log("Created local environment and private .local/login.txt. No credentials printed.");
}
