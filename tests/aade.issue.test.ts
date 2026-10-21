import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/testDb";
import { makeContext } from "./helpers/app";
import { ISSUER, makeDraft } from "./fixtures/aade";
import { insertDraft, getInvoice, nextNumber } from "../src/invoicing/invoices";
import { saveCredentials } from "../src/aade/credentials";
import { issueInvoice, IssueError } from "../src/aade/issue";
import { XsdValidationError } from "../src/aade/validate";
import type { Db } from "../src/db/db";

let db: Db;
let ctx: ReturnType<typeof makeContext>["ctx"];
beforeAll(async () => {
  db = await createTestDb();
  ctx = makeContext(db).ctx;
});

let n = 0;
async function freshUser(withCreds = true): Promise<string> {
  const [u] = await db.query<{ id: string }>("insert into users (email, password_hash) values ($1, $2) returning id", [`aade${++n}@test.gr`, "x"]);
  const userId = u!.id;
  if (withCreds) await saveCredentials(ctx, userId, "test", { username: "u-1", subscriptionKey: "key-123456" });
  return userId;
}

const respond = (xml: string): typeof fetch => (async () => new Response(xml, { status: 200 })) as typeof fetch;
const SUCCESS = "<ResponseDoc><response><invoiceUid>U9</invoiceUid><invoiceMark>400777</invoiceMark><statusCode>Success</statusCode></response></ResponseDoc>";
const REJECT = "<ResponseDoc><response><errors><error><message>bad</message><code>102</code></error></errors><statusCode>ValidationError</statusCode></response></ResponseDoc>";

describe("issueInvoice end to end", () => {
  it("issues a consumer document and stores mark, uid, number and xml", async () => {
    const userId = await freshUser();
    const row = await insertDraft(db, userId, makeDraft({ counterpart: "consumer" }));
    const result = await issueInvoice(ctx, userId, row, ISSUER, { environment: "test", issueDate: "2026-10-21", fetchImpl: respond(SUCCESS) });
    expect(result.status).toBe("issued");
    expect(result.mark).toBe("400777");

    const stored = await getInvoice(db, userId, row.id);
    expect(stored!.status).toBe("issued");
    expect(stored!.mark).toBe("400777");
    expect(stored!.uid).toBe("U9");
    expect(stored!.number).toBe(1);
    expect(stored!.issue_date).toBe("2026-10-21");
    expect(stored!.request_xml).toContain("<InvoicesDoc");
    expect(await nextNumber(db, userId, "test", "doc", "Α")).toBe(2);
  });

  it("frees the number when the document is rejected (Φ4)", async () => {
    const userId = await freshUser();
    const row = await insertDraft(db, userId, makeDraft({ counterpart: "consumer" }));
    const result = await issueInvoice(ctx, userId, row, ISSUER, { environment: "test", fetchImpl: respond(REJECT) });
    expect(result.status).toBe("rejected");
    const stored = await getInvoice(db, userId, row.id);
    expect(stored!.status).toBe("rejected");
    expect(stored!.aade_error).toMatchObject({ errors: [{ code: "102" }] });
    // A rejected number is reused: the next number is still 1.
    expect(await nextNumber(db, userId, "test", "doc", "Α")).toBe(1);
  });

  it("reserves the number when the outcome is unknown (Φ4)", async () => {
    const userId = await freshUser();
    const row = await insertDraft(db, userId, makeDraft({ counterpart: "consumer" }));
    const boom = (async () => {
      throw new Error("ECONNRESET");
    }) as typeof fetch;
    const result = await issueInvoice(ctx, userId, row, ISSUER, { environment: "test", fetchImpl: boom });
    expect(result.status).toBe("unknown");
    const stored = await getInvoice(db, userId, row.id);
    expect(stored!.status).toBe("unknown");
    // An unknown outcome keeps the number reserved: the next number advances.
    expect(await nextNumber(db, userId, "test", "doc", "Α")).toBe(2);
  });

  it("fails with a credentials error when none are configured", async () => {
    const userId = await freshUser(false);
    const row = await insertDraft(db, userId, makeDraft({ counterpart: "consumer" }));
    await expect(issueInvoice(ctx, userId, row, ISSUER, { environment: "test", fetchImpl: respond(SUCCESS) })).rejects.toBeInstanceOf(IssueError);
    // Nothing was sent: the document is still a draft.
    expect((await getInvoice(db, userId, row.id))!.status).toBe("draft");
  });

  it("never sends XML that fails the XSD, and leaves the draft untouched", async () => {
    const userId = await freshUser();
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response(SUCCESS, { status: 200 });
    }) as typeof fetch;
    // An invalid document type code produces XML that the XSD rejects.
    const row = await insertDraft(db, userId, makeDraft({ counterpart: "consumer", aadeDocCode: "999.999" }));
    await expect(issueInvoice(ctx, userId, row, ISSUER, { environment: "test", fetchImpl: spy })).rejects.toBeInstanceOf(XsdValidationError);
    expect(called).toBe(false);
    expect((await getInvoice(db, userId, row.id))!.status).toBe("draft");
  });
});
