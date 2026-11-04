import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/testDb";
import { call, makeContext, signedIn } from "./helpers/app";
import { TEST_PROFILE } from "./fixtures/profile";
import type { Db } from "../src/db/db";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});

async function setup() {
  const { app } = makeContext(db);
  const cookie = await signedIn(app);
  await call(app, "PUT", "/api/profile", { cookie, body: TEST_PROFILE });
  return { app, cookie };
}

describe("client search", () => {
  it("finds a client by name, nickname and by a car's plate", async () => {
    const { app, cookie } = await setup();
    const id = (await call(app, "POST", "/api/clients", { cookie, body: { name: "Νίκος Οδηγός", nickname: "Νίκος ταξί" } })).json.client.id as string;
    await call(app, "POST", `/api/clients/${id}/vehicles`, { cookie, body: { plate: "ΙΚΑ-2020" } });

    expect((await call(app, "GET", "/api/clients/search?q=Νίκος", { cookie })).json.clients).toHaveLength(1);
    expect((await call(app, "GET", "/api/clients/search?q=ταξί", { cookie })).json.clients[0].id).toBe(id);
    // By a car's plate, dash ignored.
    expect((await call(app, "GET", `/api/clients/search?q=${encodeURIComponent("ικα2020")}`, { cookie })).json.clients[0].id).toBe(id);
    // Empty query returns nothing.
    expect((await call(app, "GET", "/api/clients/search", { cookie })).json.clients).toHaveLength(0);
  });
});

describe("manual invoice (no voice)", () => {
  it("creates a receipt draft for a consumer from a plain form", async () => {
    const { app, cookie } = await setup();
    const clientId = (await call(app, "POST", "/api/clients", { cookie, body: { name: "Πελάτης Ιδιώτης" } })).json.client.id as string;
    const res = await call(app, "POST", "/api/invoices", {
      cookie,
      body: { client_id: clientId, description: "Αλλαγή λαδιών", amount: "80", price_basis: "with_vat" },
    });
    expect(res.status).toBe(201);
    expect(res.json.invoice).toBeTruthy();
    expect(res.json.invoice.draft.customer.name).toBe("Πελάτης Ιδιώτης");
    expect(res.json.invoice.draft.calc.totals.gross).toBe("80.00");
    // It shows up in the invoice list.
    const list = (await call(app, "GET", "/api/invoices", { cookie })).json.invoices;
    expect(list.some((i: { id: string }) => i.id === res.json.invoice.id)).toBe(true);
  });

  it("accepts a Greek-formatted amount with comma and euro sign", async () => {
    const { app, cookie } = await setup();
    const clientId = (await call(app, "POST", "/api/clients", { cookie, body: { name: "Κόμμα Ποσό" } })).json.client.id as string;
    const res = await call(app, "POST", "/api/invoices", {
      cookie,
      body: { client_id: clientId, description: "Service", amount: "124,00 €", price_basis: "with_vat" },
    });
    expect(res.status).toBe(201);
    expect(res.json.invoice.draft.calc.totals.gross).toBe("124.00");
  });

  it("rejects an empty description and a bad amount", async () => {
    const { app, cookie } = await setup();
    const clientId = (await call(app, "POST", "/api/clients", { cookie, body: { name: "Χ" } })).json.client.id as string;
    expect((await call(app, "POST", "/api/invoices", { cookie, body: { client_id: clientId, description: "", amount: "80" } })).status).toBe(400);
    expect((await call(app, "POST", "/api/invoices", { cookie, body: { client_id: clientId, description: "ok", amount: "abc" } })).status).toBe(400);
  });

  it("does not create an invoice for another user's client", async () => {
    const { app, cookie } = await setup();
    const clientId = (await call(app, "POST", "/api/clients", { cookie, body: { name: "Του Α" } })).json.client.id as string;
    const other = await signedIn(app);
    await call(app, "PUT", "/api/profile", { cookie: other, body: TEST_PROFILE });
    expect((await call(app, "POST", "/api/invoices", { cookie: other, body: { client_id: clientId, description: "x", amount: "10", price_basis: "with_vat" } })).status).toBe(404);
  });
});
