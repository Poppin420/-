import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { toDbError, type Db } from "../../src/db/db";
import { runMigrations } from "../../src/db/migrations";

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

/** Fresh in-process Postgres with all migrations applied. */
export async function createTestDb(): Promise<Db> {
  const pglite = new PGlite({ extensions: { btree_gist } });
  const db = wrap(pglite, pglite);
  await runMigrations(db);
  return db;
}
