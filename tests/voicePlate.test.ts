import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/testDb";
import { call, makeContext, signedIn } from "./helpers/app";
import { TEST_PROFILE } from "./fixtures/profile";
import type { Db } from "../src/db/db";
import type { CardPreview } from "../src/actions/actions";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});

const invoiceCmd = (clientName: string) => ({
  actions: [
    {
      type: "create_invoice",
      client_name: clientName,
      price_basis_text: "με ΦΠΑ",
      lines: [{ description: "επισκευή", amount_text: "100 ευρώ" }],
    },
  ],
});

describe("voice recognition by vehicle plate", () => {
  it("resolves the owner from any of their cars' plates", async () => {
    const t = makeContext(db);
    const cookie = await signedIn(t.app);
    await call(t.app, "PUT", "/api/profile", { cookie, body: TEST_PROFILE });

    const clientId = (await call(t.app, "POST", "/api/clients", { cookie, body: { name: "Γιώργος Παπαδόπουλος" } })).json.client.id as string;
    // Two cars; the second plate is NOT stored on the client record.
    await call(t.app, "POST", `/api/clients/${clientId}/vehicles`, { cookie, body: { plate: "ΑΒΓ-1234" } });
    await call(t.app, "POST", `/api/clients/${clientId}/vehicles`, { cookie, body: { plate: "ΖΗΘ-5678" } });

    t.willExtract(invoiceCmd("ΖΗΘ-5678"));
    const res = await call(t.app, "POST", "/api/parse", { cookie, body: { text: "κόψε απόδειξη 100 ευρώ στο ΖΗΘ-5678" } });
    expect(res.status).toBe(200);
    const preview = res.json.previews[0] as CardPreview;
    expect(preview.context.clientChoice?.selected).toBe(clientId);
    expect(preview.context.clientChoice?.options.map((o) => o.id)).toContain(clientId);
  });

  it("ignores vehicle lookup for a plain spoken name (no digits)", async () => {
    const t = makeContext(db);
    const cookie = await signedIn(t.app);
    await call(t.app, "PUT", "/api/profile", { cookie, body: TEST_PROFILE });
    const clientId = (await call(t.app, "POST", "/api/clients", { cookie, body: { name: "Μαρία" } })).json.client.id as string;
    await call(t.app, "POST", `/api/clients/${clientId}/vehicles`, { cookie, body: { plate: "ΑΒΓ-1234" } });

    t.willExtract(invoiceCmd("Μαρία"));
    const res = await call(t.app, "POST", "/api/parse", { cookie, body: { text: "κόψε απόδειξη 100 ευρώ στη Μαρία" } });
    const preview = res.json.previews[0] as CardPreview;
    expect(preview.context.clientChoice?.selected).toBe(clientId);
  });
});
