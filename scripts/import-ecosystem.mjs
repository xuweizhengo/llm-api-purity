import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDatabase, importEcosystemFromFile, initializeDatabase } from "../src/store.js";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const envFile = join(rootDir, ".env");
const ecosystemFile = process.argv[2] || join(rootDir, "data", "ecosystem.json");
const schemaFile = join(rootDir, "db", "schema.sql");
const rankingSitesFile = join(rootDir, "data", "sites.json");

await loadDotEnv(envFile);

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to import ecosystem data.");
  process.exit(1);
}

try {
  const ready = await initializeDatabase({
    schemaFile,
    ecosystemFile,
    rankingSitesFile
  });

  if (!ready) {
    console.error("Database was not initialized.");
    process.exit(1);
  }

  const result = await importEcosystemFromFile(ecosystemFile);
  console.log(`Imported ecosystem: ${result.people} people, ${result.sites} sites, ${result.featured} featured.`);
} finally {
  await closeDatabase();
}

async function loadDotEnv(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // .env is optional; Docker Compose normally injects DATABASE_URL.
  }
}
