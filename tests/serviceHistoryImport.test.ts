import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/testDb";
import { call, makeContext, signedIn } from "./helpers/app";
import type { Db } from "../src/db/db";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});

async function setup() {
  const { app } = makeContext(db);
  const cookie = await signedIn(app);
  const clientId = (await call(app, "POST", "/api/clients", { cookie, body: { name: "Κάτοχος" } })).json.client.id as string;
  const vid = (await call(app, "POST", `/api/clients/${clientId}/vehicles`, { cookie, body: { plate: "ΑΒΓ-1234" } })).json.vehicle.id as string;
  return { app, cookie, vid };
}

describe("service history import", () => {
  it("imports records matched by plate, with date, odometer and items", async () => {
    const { app, cookie, vid } = await setup();
    const res = await call(app, "POST", "/api/import/service", {
      cookie,
      body: {
        rows: [
          { plate: "αβγ1234", serviced_on: "2020-05-10", odometer: "120000", work_type: "Σέρβις", items: "Αλλαγή λαδιών;Φίλτρο λαδιού", notes: "όλα καλά" },
          { plate: "ΑΒΓ-1234", serviced_on: "", odometer: "", work_type: "Φρένα", items: ["Φρένα εμπρός"], notes: "" },
          { plate: "ΖΖΖ-0000", serviced_on: "2021-01-01", work_type: "άγνωστο αμάξι" },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(res.json.summary.created).toBe(2);
    expect(res.json.summary.skippedNoVehicle).toBe(1);

    const records = (await call(app, "GET", `/api/vehicles/${vid}/services`, { cookie })).json.records;
    expect(records).toHaveLength(2);
    // Newest-first, with the undated record last.
    const dated = records.find((r: { odometer: number | null }) => r.odometer === 120000);
    expect(dated.serviced_on).toBe("2020-05-10");
    expect(dated.items).toEqual(["Αλλαγή λαδιών", "Φίλτρο λαδιού"]);
    const undated = records.find((r: { work_type: string }) => r.work_type === "Φρένα");
    expect(undated.serviced_on).toBe(null);
    expect(undated.items).toEqual(["Φρένα εμπρός"]);
  });

  it("does not import into another user's vehicle (plate not on their account)", async () => {
    const { app } = await setup();
    const other = await signedIn(app);
    const res = await call(app, "POST", "/api/import/service", {
      cookie: other,
      body: { rows: [{ plate: "ΑΒΓ-1234", serviced_on: "2020-05-10", work_type: "x" }] },
    });
    expect(res.json.summary.created).toBe(0);
    expect(res.json.summary.skippedNoVehicle).toBe(1);
  });
});
