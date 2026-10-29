import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/testDb";
import { call, makeContext, signedIn } from "./helpers/app";
import type { Db } from "../src/db/db";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});

async function newClient(app: ReturnType<typeof makeContext>["app"], cookie: string, name = "Πελάτης συνεργείου") {
  return (await call(app, "POST", "/api/clients", { cookie, body: { name } })).json.client.id as string;
}

describe("vehicles API", () => {
  it("creates vehicles under a client, normalizes the plate and lists them", async () => {
    const { app } = makeContext(db);
    const cookie = await signedIn(app);
    const clientId = await newClient(app, cookie);

    const res = await call(app, "POST", `/api/clients/${clientId}/vehicles`, {
      cookie,
      body: { plate: "αβγ-1234", make: "Toyota", model: "Yaris", year: "2015" },
    });
    expect(res.status).toBe(201);
    expect(res.json.vehicle.plate).toBe("ΑΒΓ-1234");
    expect(res.json.vehicle.make).toBe("Toyota");
    expect(res.json.vehicle.year).toBe(2015);

    await call(app, "POST", `/api/clients/${clientId}/vehicles`, { cookie, body: { plate: "ΖΗΘ-5678" } });
    const list = (await call(app, "GET", `/api/clients/${clientId}/vehicles`, { cookie })).json.vehicles;
    expect(list).toHaveLength(2);
  });

  it("rejects a vehicle with no plate", async () => {
    const { app } = makeContext(db);
    const cookie = await signedIn(app);
    const clientId = await newClient(app, cookie);
    const res = await call(app, "POST", `/api/clients/${clientId}/vehicles`, { cookie, body: { plate: "  " } });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid year", async () => {
    const { app } = makeContext(db);
    const cookie = await signedIn(app);
    const clientId = await newClient(app, cookie);
    const res = await call(app, "POST", `/api/clients/${clientId}/vehicles`, { cookie, body: { plate: "ΑΑΑ-1", year: "1800" } });
    expect(res.status).toBe(400);
  });

  it("updates a vehicle and can clear an optional field", async () => {
    const { app } = makeContext(db);
    const cookie = await signedIn(app);
    const clientId = await newClient(app, cookie);
    const id = (await call(app, "POST", `/api/clients/${clientId}/vehicles`, { cookie, body: { plate: "ΚΛΜ-9", make: "Fiat" } })).json
      .vehicle.id as string;
    expect((await call(app, "PUT", `/api/vehicles/${id}`, { cookie, body: { model: "Panda" } })).json.vehicle.model).toBe("Panda");
    expect((await call(app, "PUT", `/api/vehicles/${id}`, { cookie, body: { make: "" } })).json.vehicle.make).toBe(null);
  });

  it("deletes a vehicle", async () => {
    const { app } = makeContext(db);
    const cookie = await signedIn(app);
    const clientId = await newClient(app, cookie);
    const id = (await call(app, "POST", `/api/clients/${clientId}/vehicles`, { cookie, body: { plate: "ΝΞΟ-7" } })).json.vehicle.id as string;
    expect((await call(app, "DELETE", `/api/vehicles/${id}`, { cookie })).status).toBe(200);
    expect((await call(app, "GET", `/api/clients/${clientId}/vehicles`, { cookie })).json.vehicles).toHaveLength(0);
  });

  it("finds a vehicle by spoken plate across clients", async () => {
    const { app } = makeContext(db);
    const cookie = await signedIn(app);
    const clientId = await newClient(app, cookie, "Αναζήτηση πινακίδας");
    await call(app, "POST", `/api/clients/${clientId}/vehicles`, { cookie, body: { plate: "ΥΧΨ-4321" } });
    const found = (await call(app, "GET", `/api/vehicles?plate=${encodeURIComponent("στο υχψ 4321 βάλε λάδια")}`, { cookie })).json.vehicles;
    expect(found).toHaveLength(1);
    expect(found[0].plate).toBe("ΥΧΨ-4321");
  });

  it("does not let a user touch another user's vehicle", async () => {
    const { app } = makeContext(db);
    const owner = await signedIn(app);
    const other = await signedIn(app);
    const clientId = await newClient(app, owner);
    const id = (await call(app, "POST", `/api/clients/${clientId}/vehicles`, { cookie: owner, body: { plate: "ΠΡΣ-1" } })).json.vehicle.id as string;
    expect((await call(app, "PUT", `/api/vehicles/${id}`, { cookie: other, body: { make: "x" } })).status).toBe(404);
    expect((await call(app, "DELETE", `/api/vehicles/${id}`, { cookie: other })).status).toBe(404);
    // Another user cannot add a vehicle to a client they do not own.
    expect((await call(app, "POST", `/api/clients/${clientId}/vehicles`, { cookie: other, body: { plate: "ΧΧΧ-9" } })).status).toBe(404);
  });
});
