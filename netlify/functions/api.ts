import { createApp } from "../../src/server/app";
import { configFromEnv, groqFromEnv, type AppContext } from "../../src/server/context";
import { createPgDb } from "../../src/db/db";

let app: ((req: Request) => Promise<Response>) | null = null;

function getApp(): ((req: Request) => Promise<Response>) | null {
  if (app) return app;
  const url = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
  if (!url) return null;
  const ctx: AppContext = {
    db: createPgDb(url),
    config: configFromEnv(),
    now: () => new Date(),
    fetch: (input, init) => fetch(input, init),
    ...groqFromEnv(),
  };
  app = createApp(ctx);
  return app;
}

export default async (req: Request): Promise<Response> => {
  const handler = getApp();
  if (!handler) {
    return new Response(JSON.stringify({ error: "Η υπηρεσία δεν έχει ρυθμιστεί." }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  return handler(req);
};

export const config = {
  path: "/api/*",
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
