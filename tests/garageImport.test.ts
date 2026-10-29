import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/testDb";
import { call, makeContext, signedIn } from "./helpers/app";
import type { Db } from "../src/db/db";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});

async function importRows(app: ReturnType<typeof makeContext>["app"], cookie: string, rows: unknown[]) {
  return call(app, "POST", "/api/import/garage", { cookie, body: { rows } });
}

describe("garage import", () => {
  it("creates one client per owner and one vehicle per car, collapsing an owner's cars", async () => {
    const { app } = makeContext(db);
    const cookie = await signedIn(app);
    const res = await importRows(app, cookie, [
      { name: "Γιώργος Παπαδόπουλος", vat_number: "123456789", phone: "2101234567", plate: "ΑΒΓ-1234", make: "Toyota", model: "Yaris", year: "2015" },
      { name: "Γιώργος Παπαδόπουλος", vat_number: "123456789", plate: "ΖΗΘ-5678", make: "Fiat" },
      { name: "Μαρία", plate: "ΚΛΜ-9012" },
    ]);
    expect(res.status).toBe(200);
    expect(res.json.summary.clientsCreated).toBe(2);
    expect(res.json.summary.vehiclesCreated).toBe(3);

    const clients = (await call(app, "GET", "/api/clients", { cookie })).json.clients;
    const giorgos = clients.find((c: { name: string }) => c.name === "Γιώργος Παπαδόπουλος");
    expect(giorgos).toBeTruthy();
    const cars = (await call(app, "GET", `/api/clients/${giorgos.id}/vehicles`, { cookie })).json.vehicles;
    expect(cars).toHaveLength(2);
  });

  it("is idempotent: re-importing the same rows adds nothing", async () => {
    const { app } = makeContext(db);
    const cookie = await signedIn(app);
    const rows = [{ name: "Κώστας", vat_number: "987654321", plate: "ΝΞΟ-1111", make: "Opel" }];
    await importRows(app, cookie, rows);
    const second = await importRows(app, cookie, rows);
    expect(second.json.summary.clientsCreated).toBe(0);
    expect(second.json.summary.vehiclesCreated).toBe(0);
    expect(second.json.summary.vehiclesSkipped).toBe(1);
  });

  it("attaches a car with no owner name to a plate-named placeholder client", async () => {
    const { app } = makeContext(db);
    const cookie = await signedIn(app);
    const res = await importRows(app, cookie, [{ plate: "ΠΡΣ-2222", make: "VW" }]);
    expect(res.json.summary.clientsCreated).toBe(1);
    expect(res.json.summary.vehiclesCreated).toBe(1);
    const clients = (await call(app, "GET", "/api/clients", { cookie })).json.clients;
    expect(clients.some((c: { name: string }) => c.name.includes("ΠΡΣ-2222"))).toBe(true);
  });

  it("skips a row with neither name nor plate", async () => {
    const { app } = makeContext(db);
    const cookie = await signedIn(app);
    const res = await importRows(app, cookie, [{ phone: "210" }, { name: "  " }]);
    expect(res.json.summary.rowsSkipped).toBe(2);
  });

  it("does not leak imported data across users", async () => {
    const { app } = makeContext(db);
    const a = await signedIn(app);
    const b = await signedIn(app);
    await importRows(app, a, [{ name: "Μόνο του Α", plate: "ΑΑΑ-1" }]);
    const clientsB = (await call(app, "GET", "/api/clients", { cookie: b })).json.clients;
    expect(clientsB.some((c: { name: string }) => c.name === "Μόνο του Α")).toBe(false);
  });
});
