import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

// Private, restorable database snapshot before local schema changes.
const directory = new URL("../.local/", import.meta.url);
await mkdir(directory, { recursive: true, mode: 0o700 });
const filename = `backup-${new Date().toISOString().replaceAll(":", "-")}.dump`;
const backup = execFileSync("docker", ["exec", "tracker-postgres-1", "pg_dump", "-U", "workout", "-Fc", "workout"], { maxBuffer: 100_000_000 });
await writeFile(new URL(filename, directory), backup, { mode: 0o600 });
console.log(`Private database backup saved: .local/${filename} (${backup.length} bytes)`);
