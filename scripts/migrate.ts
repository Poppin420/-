/** Applies pending migrations: DATABASE_URL=... npm run db:migrate */
import { createPgDb } from "../src/db/db";
import { runMigrations } from "../src/db/migrations";

const url = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(2);
}
const applied = await runMigrations(createPgDb(url));
console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Up to date");
process.exit(0);
