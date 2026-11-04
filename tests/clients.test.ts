import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/testDb";
import { call, makeContext, signedIn } from "./helpers/app";
import type { Db } from "../src/db/db";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});

async function clientsOf(app: ReturnType<typeof makeContext>["app"], cookie: string) {
  return (await call(app, "GET", "/api/clients", { cookie })).json.clients as Array<{ id: string; name: string; nickname: string | null }>;
}

describe("clients API", () => {
  it("creates a client with a nickname and lists it", async () => {
    const { app } = makeContext(db);
    const cookie = await signedIn(app);
    const res = await call(app, "POST", "/api/clients", { cookie, body: { name: "Γιώργος Παπαδόπουλος", nickname: "Γιώργος σίδερα" } });
    expect(res.status).toBe(201);
    expect(res.json.client.nickname).toBe("Γιώργος σίδερα");
    const list = await clientsOf(app, cookie);
    expect(list.find((c) => c.name === "Γιώργος Παπαδόπουλος")?.nickname).toBe("Γιώργος σίδερα");
  });

  it("stores a vehicle plate and normalizes it to uppercase", async () => {
    const { app } = makeContext(db);
    const cookie = await signedIn(app);
    const res = await call(app, "POST", "/api/clients", { cookie, body: { name: "Πελάτης συνεργείου", plate: "αβγ-1234" } });
    expect(res.status).toBe(201);
    expect(res.json.client.plate).toBe("ΑΒΓ-1234");
    const got = (await call(app, "GET", "/api/clients", { cookie })).json.clients.find((c: { plate: string | null }) => c.plate === "ΑΒΓ-1234");
    expect(got).toBeTruthy();
  });

  it("updates the nickname and can clear it", async () => {
    const { app } = makeContext(db);
    const cookie = await signedIn(app);
    const created = await call(app, "POST", "/api/clients", { cookie, body: { name: "Μαρία" } });
    const id = created.json.client.id as string;
    expect((await call(app, "PUT", `/api/clients/${id}`, { cookie, body: { nickname: "Μαρία πιάνο" } })).json.client.nickname).toBe("Μαρία πιάνο");
    expect((await call(app, "PUT", `/api/clients/${id}`, { cookie, body: { nickname: "" } })).json.client.nickname).toBe(null);
  });

  it("rejects an invalid AFM", async () => {
    const { app } = makeContext(db);
    const cookie = await signedIn(app);
    const res = await call(app, "POST", "/api/clients", { cookie, body: { name: "Χ", vat_number: "123" } });
    expect(res.status).toBe(400);
  });

  it("does not let a user edit another user's client", async () => {
    const { app } = makeContext(db);
    const owner = await signedIn(app);
    const other = await signedIn(app);
    const id = (await call(app, "POST", "/api/clients", { cookie: owner, body: { name: "Κώστας" } })).json.client.id as string;
    const res = await call(app, "PUT", `/api/clients/${id}`, { cookie: other, body: { nickname: "χ" } });
    expect(res.status).toBe(404);
    // The owner's client is untouched.
    expect((await clientsOf(app, owner)).find((c) => c.id === id)?.nickname).toBe(null);
  });
});
