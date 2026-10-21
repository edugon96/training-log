import { mkdir, writeFile } from "node:fs/promises";
import { buildHybridExample } from "../examples/hybrid-hypertrophy";

await mkdir("examples", { recursive: true });
await writeFile("examples/hybrid-hypertrophy.json", JSON.stringify(buildHybridExample(), null, 2) + "\n");
console.log("Generated synthetic Hybrid Hypertrophy profile. No personal data read.");
