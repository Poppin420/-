import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/testDb";
import { call, makeContext, signedIn } from "./helpers/app";
import type { Db } from "../src/db/db";
import { DEFAULT_SERVICE_ITEMS } from "../src/vehicles/serviceItems";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});

async function vehicleOf(app: ReturnType<typeof makeContext>["app"], cookie: string) {
  const clientId = (await call(app, "POST", "/api/clients", { cookie, body: { name: "Πελάτης" } })).json.client.id as string;
  return (await call(app, "POST", `/api/clients/${clientId}/vehicles`, { cookie, body: { plate: "ΑΒΓ-1234" } })).json.vehicle.id as string;
}

describe("service checklist", () => {
  it("seeds the Greek defaults on first use", async () => {
    const { app } = makeContext(db);
    const cookie = await signedIn(app);
    const items = (await call(app, "GET", "/api/service-items", { cookie })).json.items;
    expect(items).toHaveLength(DEFAULT_SERVICE_ITEMS.length);
    expect(items.map((i: { label: string }) => i.label)).toContain("Αλλαγή λαδιών");
  });

  it("seeds only once", async () => {
    const { app } = makeContext(db);
    const cookie = await signedIn(app);
    const first = (await call(app, "GET", "/api/service-items", { cookie })).json.items;
    const second = (await call(app, "GET", "/api/service-items", { cookie })).json.items;
    expect(second).toHaveLength(first.length);
  });

  it("adds, renames, hides and deletes a custom item", async () => {
    const { app } = makeContext(db);
    const cookie = await signedIn(app);
    await call(app, "GET", "/api/service-items", { cookie }); // seed
    const created = await call(app, "POST", "/api/service-items", { cookie, body: { label: "Ευθυγράμμιση", category: "Ανάρτηση / φρένα" } });
    expect(created.status).toBe(201);
    const id = created.json.item.id as string;
    expect((await call(app, "PUT", `/api/service-items/${id}`, { cookie, body: { label: "Ευθυγράμμιση ελαστικών" } })).json.item.label).toBe(
      "Ευθυγράμμιση ελαστικών",
    );
    expect((await call(app, "PUT", `/api/service-items/${id}`, { cookie, body: { active: false } })).json.item.active).toBe(false);
    const activeOnly = (await call(app, "GET", "/api/service-items?active=1", { cookie })).json.items;
    expect(activeOnly.find((i: { id: string }) => i.id === id)).toBeUndefined();
    expect((await call(app, "DELETE", `/api/service-items/${id}`, { cookie })).status).toBe(200);
  });

  it("rejects an empty label", async () => {
    const { app } = makeContext(db);
    const cookie = await signedIn(app);
    expect((await call(app, "POST", "/api/service-items", { cookie, body: { label: "  " } })).status).toBe(400);
  });
});

describe("service history", () => {
  it("records a visit with odometer and done items, newest first", async () => {
    const { app } = makeContext(db);
    const cookie = await signedIn(app);
    const vid = await vehicleOf(app, cookie);
    await call(app, "POST", `/api/vehicles/${vid}/services`, {
      cookie,
      body: { serviced_on: "2024-01-10", odometer: 120000, work_type: "Service", items: ["Αλλαγή λαδιών", "Φίλτρο λαδιού"] },
    });
    const second = await call(app, "POST", `/api/vehicles/${vid}/services`, {
      cookie,
      body: { serviced_on: "2025-03-01", odometer: 135000, items: ["Φρένα εμπρός", "Φρένα εμπρός"] },
    });
    expect(second.status).toBe(201);
    expect(second.json.record.items).toEqual(["Φρένα εμπρός"]); // de-duplicated
    const records = (await call(app, "GET", `/api/vehicles/${vid}/services`, { cookie })).json.records;
    expect(records).toHaveLength(2);
    expect(records[0].serviced_on).toContain("2025-03-01"); // newest first
    expect(records[0].odometer).toBe(135000);
  });

  it("rejects a bad date and bad odometer", async () => {
    const { app } = makeContext(db);
    const cookie = await signedIn(app);
    const vid = await vehicleOf(app, cookie);
    expect((await call(app, "POST", `/api/vehicles/${vid}/services`, { cookie, body: { serviced_on: "nope" } })).status).toBe(400);
    expect((await call(app, "POST", `/api/vehicles/${vid}/services`, { cookie, body: { serviced_on: "2024-01-10", odometer: -5 } })).status).toBe(400);
  });

  it("updates and deletes a record", async () => {
    const { app } = makeContext(db);
    const cookie = await signedIn(app);
    const vid = await vehicleOf(app, cookie);
    const id = (await call(app, "POST", `/api/vehicles/${vid}/services`, { cookie, body: { serviced_on: "2024-06-01" } })).json.record.id as string;
    expect((await call(app, "PUT", `/api/services/${id}`, { cookie, body: { work_type: "Μεγάλο service" } })).json.record.work_type).toBe("Μεγάλο service");
    expect((await call(app, "DELETE", `/api/services/${id}`, { cookie })).status).toBe(200);
    expect((await call(app, "GET", `/api/vehicles/${vid}/services`, { cookie })).json.records).toHaveLength(0);
  });

  it("isolates history between users", async () => {
    const { app } = makeContext(db);
    const owner = await signedIn(app);
    const other = await signedIn(app);
    const vid = await vehicleOf(app, owner);
    expect((await call(app, "POST", `/api/vehicles/${vid}/services`, { cookie: other, body: { serviced_on: "2024-06-01" } })).status).toBe(404);
    expect((await call(app, "GET", `/api/vehicles/${vid}/services`, { cookie: other })).status).toBe(404);
  });
});
