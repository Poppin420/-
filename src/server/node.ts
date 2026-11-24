import { createServer } from "node:http";
import { join } from "node:path";
import { createApp } from "./app";
import { configFromEnv, groqFromEnv, type AppContext } from "./context";
import { createRequestListener } from "./httpListener";
import { createPgDb } from "../db/db";
import { runMigrations } from "../db/migrations";

/**
 * Portable Node server: serves the built frontend and routes /api/* through the
 * same handler the Netlify function uses. Runs on any host that gives it a Node
 * process, a PORT and a PostgreSQL DATABASE_URL (Render, Railway, Fly, a VPS…).
 * Database migrations run once on startup.
 */

const PORT = Number(process.env.PORT || 3000);
const STATIC_DIR = process.env.STATIC_DIR || join(process.cwd(), "web", "dist");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const db = createPgDb(url);
  const applied = await runMigrations(db);
  console.log(applied.length > 0 ? `Applied migrations: ${applied.join(", ")}` : "Database schema up to date");

  const ctx: AppContext = {
    db,
    config: configFromEnv(),
    now: () => new Date(),
    fetch: (input, init) => fetch(input, init),
    ...groqFromEnv(),
  };
  const app = createApp(ctx);
  const server = createServer(createRequestListener(app, STATIC_DIR));
  server.listen(PORT, () => console.log(`Listening on http://0.0.0.0:${PORT}`));
}

void main();
