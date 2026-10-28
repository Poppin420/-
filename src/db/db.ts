import pg from "pg";

/** Minimal database interface shared by the production pool and in-process PGlite in tests. */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

export class DbError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly constraint?: string,
  ) {
    super(message);
    this.name = "DbError";
  }
}

/** Postgres error codes we react to. */
export const PG_UNIQUE_VIOLATION = "23505";
export const PG_EXCLUSION_VIOLATION = "23P01";

export function toDbError(e: unknown): DbError {
  const err = e as { code?: string; constraint?: string; message?: string };
  return new DbError(err.message ?? "database error", err.code, err.constraint);
}

export function createPgDb(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 10_000,
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? undefined : { rejectUnauthorized: true },
  });

  const run = async <T>(client: pg.Pool | pg.PoolClient, text: string, params?: unknown[]): Promise<T[]> => {
    try {
      return (await client.query(text, params as unknown[])).rows as T[];
    } catch (e) {
      throw toDbError(e);
    }
  };

  return {
    query: (text, params) => run(pool, text, params),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({
          query: (text, params) => run(client, text, params),
          transaction: () => Promise.reject(new Error("nested transactions are not supported")),
        });
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
  };
}
