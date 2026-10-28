import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/testDb";
import { runMigrations } from "../src/db/migrations";
import { PG_EXCLUSION_VIOLATION } from "../src/db/db";

describe("migrations", () => {
  it("apply once and are idempotent", async () => {
    const db = await createTestDb();
    expect(await runMigrations(db)).toEqual([]);
  });

  it("database rejects overlapping scheduled appointments but allows cancelled ones", async () => {
    const db = await createTestDb();
    const [u] = await db.query<{ id: string }>("insert into users (email, password_hash) values ('a@b.gr','x') returning id");
    const ins = (start: string, end: string, status = "scheduled") =>
      db.query("insert into appointments (user_id, client_name, starts_at, ends_at, status) values ($1,'Μ',$2,$3,$4)", [u!.id, start, end, status]);
    await ins("2026-10-22T14:00:00Z", "2026-10-22T15:00:00Z");
    await ins("2026-10-22T15:00:00Z", "2026-10-22T16:00:00Z"); // touching is fine
    await ins("2026-10-22T14:30:00Z", "2026-10-22T15:30:00Z", "cancelled");
    await expect(ins("2026-10-22T14:30:00Z", "2026-10-22T14:45:00Z")).rejects.toMatchObject({ code: PG_EXCLUSION_VIOLATION });
  });
});
