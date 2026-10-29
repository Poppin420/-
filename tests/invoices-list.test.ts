import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/testDb";
import { call, makeContext, signedIn } from "./helpers/app";
import { insertDraft } from "../src/invoicing/invoices";
import { makeDraft } from "./fixtures/aade";
import type { Db } from "../src/db/db";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});

async function seed(userId: string, names: string[]) {
  const base = makeDraft({ counterpart: "consumer" });
  for (const name of names) {
    await insertDraft(db, userId, { ...base, customer: { ...base.customer, name } });
  }
}

async function userIdOf(app: ReturnType<typeof makeContext>["app"], cookie: string): Promise<string> {
  return (await call(app, "GET", "/api/auth/me", { cookie })).json.user.id;
}

describe("invoices listing", () => {
  it("searches by client name and paginates beyond 200", async () => {
    const { app } = makeContext(db);
    const cookie = await signedIn(app);
    const userId = await userIdOf(app, cookie);
    const names = Array.from({ length: 205 }, (_, i) => (i % 2 === 0 ? `Μαρία ${i}` : `Γιώργος ${i}`));
    await seed(userId, names);

    // Default page is 50 with more available (we inserted 205 > 200, so the old cap would have hidden some).
    const first = await call(app, "GET", "/api/invoices", { cookie });
    expect(first.json.invoices).toHaveLength(50);
    expect(first.json.hasMore).toBe(true);

    // Walk every page and confirm all 205 are reachable.
    let total = 0;
    for (let offset = 0; ; offset += 100) {
      const page = await call(app, "GET", `/api/invoices?limit=100&offset=${offset}`, { cookie });
      total += page.json.invoices.length;
      if (!page.json.hasMore) break;
    }
    expect(total).toBe(205);

    // Search narrows to the matching client.
    const maria = await call(app, "GET", "/api/invoices?q=" + encodeURIComponent("Μαρία") + "&limit=200", { cookie });
    expect(maria.json.invoices.length).toBe(103);
    expect(maria.json.invoices.every((inv: { draft: { customer: { name: string } } }) => inv.draft.customer.name.startsWith("Μαρία"))).toBe(true);
  });

  it("searches by customer AFM and by amount", async () => {
    const { app } = makeContext(db);
    const cookie = await signedIn(app);
    const userId = await userIdOf(app, cookie);
    // A business invoice carries a customer AFM; its gross is 124.00 (100 net + 24% VAT).
    await insertDraft(db, userId, makeDraft({ counterpart: "business", vatNumber: "123456789" }));
    expect((await call(app, "GET", "/api/invoices?q=123456789", { cookie })).json.invoices).toHaveLength(1);
    expect((await call(app, "GET", "/api/invoices?q=124", { cookie })).json.invoices).toHaveLength(1);
    expect((await call(app, "GET", "/api/invoices?q=999999999", { cookie })).json.invoices).toHaveLength(0);
  });

  it("filters by status", async () => {
    const { app } = makeContext(db);
    const cookie = await signedIn(app);
    const userId = await userIdOf(app, cookie);
    await seed(userId, ["Πελάτης Α", "Πελάτης Β"]);
    expect((await call(app, "GET", "/api/invoices?status=draft", { cookie })).json.invoices).toHaveLength(2);
    expect((await call(app, "GET", "/api/invoices?status=issued", { cookie })).json.invoices).toHaveLength(0);
  });
});
