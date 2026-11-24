import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { toDbError, type Db } from "./db";

type Queryable = Pick<PGlite, "query">;

function wrap(q: Queryable, root: PGlite | null): Db {
  return {
    async query<T>(text: string, params?: unknown[]) {
      try {
        return (await q.query<T>(text, params)).rows;
      } catch (e) {
        throw toDbError(e);
      }
    },
    async transaction(fn) {
      if (!root) throw new Error("nested transactions are not supported");
      return root.transaction((tx) => fn(wrap(tx, null)));
    },
  };
}

/**
 * An embedded PostgreSQL (PGlite) stored on disk — the database for the desktop
 * build, so the app needs no separate database server. The same code the cloud
 * server runs on real Postgres runs here unchanged. `dataDir` is where the data
 * is kept; omit it for an in-memory database.
 */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const pglite = dataDir
    ? new PGlite({ dataDir, extensions: { btree_gist } })
    : new PGlite({ extensions: { btree_gist } });
  await pglite.waitReady;
  return wrap(pglite, pglite);
}
