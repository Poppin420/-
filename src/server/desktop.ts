import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { createApp } from "./app";
import type { AppContext } from "./context";
import { createRequestListener } from "./httpListener";
import { createPgliteDb } from "../db/pglite";
import { runMigrations } from "../db/migrations";
import { SecretBox } from "../security/secretBox";
import { DEFAULT_SCRYPT_LOG_N } from "../security/password";
import type { Db } from "../db/db";

export interface DesktopServer {
  port: number;
  url: string;
}

export interface DesktopOptions {
  /** Folder where the embedded database is stored (persists between runs). */
  dataDir: string;
  /** Folder with the built front-end (index.html, assets…). */
  staticDir: string;
  /** Port to listen on (127.0.0.1 only); 0 or omitted picks a free one. */
  port?: number;
  /** Base64 key (32 bytes) that encrypts stored AADE credentials. Optional. */
  encryptionKey?: string;
}

/**
 * Starts the whole app in one local process for the desktop build: an embedded
 * PostgreSQL (PGlite) on disk, the same API, and the built front-end — on
 * 127.0.0.1 only. There is one local user and no login (see authenticate()).
 */
export async function startDesktopServer(opts: DesktopOptions): Promise<DesktopServer> {
  const db = await createPgliteDb(opts.dataDir);
  await runMigrations(db);
  const localUserId = await ensureLocalUser(db);

  const ctx: AppContext = {
    db,
    config: {
      baseUrl: null,
      signupCode: null,
      secretBox: opts.encryptionKey ? new SecretBox(opts.encryptionKey) : null,
      google: null,
      scryptLogN: DEFAULT_SCRYPT_LOG_N,
      secureCookies: false,
      localUserId,
    },
    now: () => new Date(),
    fetch: (input, init) => fetch(input, init),
    llm: null,
    transcribe: null,
  };

  const app = createApp(ctx);
  const server = createServer(createRequestListener(app, opts.staticDir));
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : (opts.port ?? 0));
    });
  });
  return { port, url: `http://127.0.0.1:${port}` };
}

/** One local user for the single-user desktop app; created once, reused after. */
async function ensureLocalUser(db: Db): Promise<string> {
  const [existing] = await db.query<{ id: string }>("select id from users order by created_at limit 1");
  if (existing) return existing.id;
  const [row] = await db.query<{ id: string }>(
    "insert into users (email, password_hash) values ($1, $2) returning id",
    ["local@local", randomBytes(16).toString("hex")],
  );
  return row!.id;
}
