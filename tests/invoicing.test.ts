import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "./helpers/testDb";
import { call, makeContext, signedIn } from "./helpers/app";
import { TEST_PROFILE, TEST_SPEC } from "./fixtures/profile";
import { EMPTY_PROFILE, profileIssues, type BusinessProfile } from "../src/invoicing/profile";
import { getInvoice, issueChecks, nextNumber, type InvoiceRow } from "../src/invoicing/invoices";
import { saveCredentials } from "../src/aade/credentials";
import { SPEC } from "../src/aade/spec";
import type { Db } from "../src/db/db";
import type { CardPreview } from "../src/actions/actions";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});

type T = ReturnType<typeof makeContext>;

const invoiceCmd = (client: string, description: string, amount: string, basis = "με ΦΠΑ", qty?: string) => ({
  actions: [
    {
      type: "create_invoice",
      client_name: client,
      price_basis_text: basis,
      lines: [{ description, amount_text: amount, ...(qty ? { quantity_text: qty } : {}) }],
    },
  ],
});

async function setup(profile: BusinessProfile | null = TEST_PROFILE) {
  const t = makeContext(db);
  const cookie = await signedIn(t.app);
  if (profile) expect((await call(t.app, "PUT", "/api/profile", { cookie, body: profile })).status).toBe(200);
  return { t, cookie };
}

async function command(t: T, cookie: string, transcript: string, extraction: unknown) {
  t.willExtract(extraction);
  const res = await call(t.app, "POST", "/api/parse", { cookie, body: { text: transcript } });
  expect(res.status).toBe(200);
  return { transcript, preview: res.json.previews[0] as CardPreview };
}

function execute(t: T, cookie: string, transcript: string, p: CardPreview, choices = {}) {
  return call(t.app, "POST", "/api/actions/execute", {
    cookie,
    body: { card: { id: p.card.id, raw: p.card.raw, userProvided: p.card.userProvided }, transcript, choices },
  });
}

async function userIdOf(t: T, cookie: string): Promise<string> {
  return (await call(t.app, "GET", "/api/auth/me", { cookie })).json.user.id;
}

async function createClient(t: T, cookie: string, name: string, afm?: string) {
  const extraction = { actions: [{ type: "create_client", client_name: name, ...(afm ? { vat_number_text: afm } : {}) }] };
  const transcript = `Νέος πελάτης ${name}${afm ? ` με ΑΦΜ ${afm}` : ""}`;
  const c = await command(t, cookie, transcript, extraction);
  expect((await execute(t, cookie, c.transcript, c.preview)).status).toBe(200);
}

/** Books a consumer receipt draft and returns its id. */
async function draftReceipt(t: T, cookie: string, amount = "80 ευρώ") {
  const c = await command(t, cookie, `Κόψε απόδειξη ${amount} με ΦΠΑ στη Μαρία για μάθημα`, invoiceCmd("Μαρία", "μάθημα", amount));
  const res = await execute(t, cookie, c.transcript, c.preview);
  expect(res.status).toBe(200);
  return res.json.invoiceId as string;
}

describe("business profile", () => {
  it("lists everything missing in an empty profile", () => {
    const fields = profileIssues(EMPTY_PROFILE).map((i) => i.field);
    for (const f of ["afm", "legal_name", "doy", "address", "activity", "vat_regime", "vat_categories", "document_types", "reviewed_by_accountant"]) {
      expect(fields).toContain(f);
    }
  });

  it("accepts a complete profile", () => {
    expect(profileIssues(TEST_PROFILE)).toEqual([]);
    expect(profileIssues(TEST_PROFILE, TEST_SPEC)).toEqual([]);
  });

  it("requires exemption codes for 0% and only 0% under the exempt regime", () => {
    const zeroNoCode = { ...TEST_PROFILE, vat_categories: [{ ...TEST_PROFILE.vat_categories[2]!, exemption_code: "" }], default_vat_category_id: "zero" };
    expect(profileIssues(zeroNoCode).map((i) => i.field)).toContain("vat_categories.0.exemption_code");
    expect(profileIssues({ ...TEST_PROFILE, vat_regime: "exempt" }).map((i) => i.message)).toContain(
      "Σε καθεστώς απαλλαγής όλες οι κατηγορίες ΦΠΑ πρέπει να είναι 0%.",
    );
  });

  it("cross-checks codes against the loaded catalog", () => {
    const bad = { ...TEST_PROFILE, document_types: [{ ...TEST_PROFILE.document_types[0]!, aade_code: "NOPE" }] };
    expect(profileIssues(bad, TEST_SPEC).map((i) => i.field)).toContain("document_types.0.aade_code");
  });

  it("validates and stores the profile per user", async () => {
    const { t, cookie } = await setup(null);
    expect((await call(t.app, "PUT", "/api/profile", { cookie, body: { ...TEST_PROFILE, vat_categories: [{ ...TEST_PROFILE.vat_categories[0]!, rate: "24%" }] } })).status).toBe(400);
    const empty = await call(t.app, "GET", "/api/profile", { cookie });
    expect(empty.json.issues.length).toBeGreaterThan(5);
    // The catalog is loaded and verified, so issuance is unlocked (still test-only).
    expect(empty.json.spec).toEqual({ version: "2.0.2", verified: true });
    await call(t.app, "PUT", "/api/profile", { cookie, body: TEST_PROFILE });
    expect((await call(t.app, "GET", "/api/profile", { cookie })).json.profile.afm).toBe("094014201");
    const other = await signedIn(t.app);
    expect((await call(t.app, "GET", "/api/profile", { cookie: other })).json.profile.afm).toBe("");
  });
});

describe("AADE credentials", () => {
  it("stores credentials encrypted and only returns a masked hint", async () => {
    const { t, cookie } = await setup(null);
    const res = await call(t.app, "PUT", "/api/aade/credentials/test", { cookie, body: { username: "myuser", subscriptionKey: "sk-very-secret-123" } });
    expect(res.status).toBe(200);
    expect(res.json.credentials.test).toMatchObject({ configured: true, usernameHint: "my****" });
    expect(res.text).not.toContain("sk-very-secret-123");
    const rows = await db.query<Record<string, string>>("select username_enc, subscription_key_enc from aade_credentials");
    for (const r of rows) {
      expect(r.username_enc).not.toContain("myuser");
      expect(r.subscription_key_enc).not.toContain("sk-very-secret");
    }
  });

  it("keeps test and production separate and requires confirmation for production", async () => {
    const { t, cookie } = await setup(null);
    const body = { username: "produser", subscriptionKey: "prod-key-12345" };
    expect((await call(t.app, "PUT", "/api/aade/credentials/prod", { cookie, body })).status).toBe(400);
    const ok = await call(t.app, "PUT", "/api/aade/credentials/prod", { cookie, body: { ...body, confirmProduction: true } });
    expect(ok.json.credentials).toMatchObject({ test: { configured: false }, prod: { configured: true } });
  });

  it("deletes on request and never leaks across users", async () => {
    const { t, cookie } = await setup(null);
    await call(t.app, "PUT", "/api/aade/credentials/test", { cookie, body: { username: "u1", subscriptionKey: "key-123456" } });
    const other = await signedIn(t.app);
    expect((await call(t.app, "GET", "/api/aade/credentials", { cookie: other })).json.credentials.test.configured).toBe(false);
    const del = await call(t.app, "DELETE", "/api/aade/credentials/test", { cookie });
    expect(del.json.credentials.test.configured).toBe(false);
  });

  it("refuses to store keys without an encryption key, and the connection test stays locked", async () => {
    const { t, cookie } = await setup(null);
    t.ctx.config.secretBox = null;
    expect((await call(t.app, "PUT", "/api/aade/credentials/test", { cookie, body: { username: "u", subscriptionKey: "key-123456" } })).status).toBe(503);
    expect((await call(t.app, "POST", "/api/aade/test/test", { cookie })).status).toBe(503);
  });
});

describe("invoice cards and drafts", () => {
  it("plans a consumer receipt with deterministic VAT and saves a draft", async () => {
    const { t, cookie } = await setup();
    const c = await command(t, cookie, "Κόψε απόδειξη 80 ευρώ με ΦΠΑ στη Μαρία για μάθημα", invoiceCmd("Μαρία", "μάθημα", "80 ευρώ"));
    const plan = c.preview.context.invoice!;
    expect(plan.counterpart).toBe("consumer");
    expect(plan.documentTypeChoice.selected).toBe("receipt");
    expect(plan.calc!.totals).toEqual({ net: "64.52", vat: "15.48", gross: "80.00", withholdings: "0.00", payable: "80.00" });
    expect(c.preview.context.warnings).toContain("Γραμμή 1: ΦΠΑ «Κανονικός» (προεπιλογή του προφίλ).");
    const res = await execute(t, cookie, c.transcript, c.preview);
    expect(res.json.message).toContain("«Έκδοση»");
    const inv = await call(t.app, "GET", `/api/invoices/${res.json.invoiceId}`, { cookie });
    expect(inv.json.invoice).toMatchObject({ status: "draft", series: "Α", number: null });
    expect(inv.json.invoice.draft.customer).toMatchObject({ name: "Μαρία", counterpart: "consumer" });
    expect(inv.json.issuer.afm).toBe("094014201");
  });

  it("uses the catalog's VAT category and lets the user override per line", async () => {
    const { t, cookie } = await setup();
    const c = await command(t, cookie, "Απόδειξη στη Μαρία για μάθημα πιάνου 30 ευρώ με ΦΠΑ", invoiceCmd("Μαρία", "μάθημα πιάνου", "30 ευρώ"));
    expect(c.preview.context.invoice!.lines[0]).toMatchObject({ vat_category_id: "red", source: "catalog" });
    expect(c.preview.context.invoice!.calc!.totals.vat).toBe("3.45");
    const p = c.preview;
    const re = await call(t.app, "POST", "/api/actions/preview", {
      cookie,
      body: { card: { id: p.card.id, raw: p.card.raw, userProvided: p.card.userProvided }, transcript: c.transcript, choices: { lineVatCategoryIds: ["std"] } },
    });
    expect(re.json.context.invoice.calc.totals.vat).toBe("5.81");
  });

  it("uses business document types and withholdings for clients with an AFM", async () => {
    const { t, cookie } = await setup();
    await createClient(t, cookie, "Άλφα ΑΕ", "800123456");
    const c = await command(t, cookie, "Τιμολόγιο στην Άλφα ΑΕ 1000 ευρώ πλέον ΦΠΑ για συμβουλευτικές", invoiceCmd("Άλφα ΑΕ", "συμβουλευτικές", "1000 ευρώ", "πλέον ΦΠΑ"));
    const plan = c.preview.context.invoice!;
    expect(plan.counterpart).toBe("business");
    expect(plan.documentTypeChoice.selected).toBe("invoice");
    expect(plan.calc!.totals).toEqual({ net: "1000.00", vat: "240.00", gross: "1240.00", withholdings: "200.00", payable: "1040.00" });
  });

  it("blocks drafts when the profile has no VAT categories", async () => {
    const { t, cookie } = await setup({ ...EMPTY_PROFILE });
    const c = await command(t, cookie, "Κόψε απόδειξη 80 ευρώ με ΦΠΑ στη Μαρία για μάθημα", invoiceCmd("Μαρία", "μάθημα", "80 ευρώ"));
    expect(c.preview.context.blockers.join(" ")).toContain("κατηγορίες ΦΠΑ");
    expect((await execute(t, cookie, c.transcript, c.preview)).status).toBe(409);
  });

  it("only deletes drafts, and only the owner's", async () => {
    const { t, cookie } = await setup();
    const id = await draftReceipt(t, cookie);
    const other = await signedIn(t.app);
    expect((await call(t.app, "GET", `/api/invoices/${id}`, { cookie: other })).status).toBe(404);
    expect((await call(t.app, "POST", `/api/invoices/${id}/delete`, { cookie: other })).status).toBe(409);
    expect((await call(t.app, "POST", `/api/invoices/${id}/delete`, { cookie })).status).toBe(200);
  });
});

describe("issuance gate", () => {
  it("requires explicit confirmation; the spec gate is now satisfied", async () => {
    const { t, cookie } = await setup();
    const id = await draftReceipt(t, cookie);
    // No confirmation → blocked.
    expect((await call(t.app, "POST", `/api/invoices/${id}/issue`, { cookie, body: {} })).status).toBe(400);
    // Confirmed, but this user has no AADE credentials yet, so it is still blocked —
    // by the credentials check, not by spec_verified, which now passes.
    const res = await call(t.app, "POST", `/api/invoices/${id}/issue`, { cookie, body: { confirm: true } });
    expect(res.status).toBe(409);
    expect(res.json.checks.find((c: { code: string }) => c.code === "spec_verified").ok).toBe(true);
    expect(res.json.checks.find((c: { code: string }) => c.code === "credentials").ok).toBe(false);
    expect(SPEC.verified).toBe(true);
  });

  /** Builds a draft where every check passes (with the fake verified spec), then breaks one thing at a time. */
  async function passingCase() {
    const { t, cookie } = await setup();
    const userId = await userIdOf(t, cookie);
    await saveCredentials(t.ctx, userId, "test", { username: "u", subscriptionKey: "key-123456" });
    const id = await draftReceipt(t, cookie);
    const invoice = (await getInvoice(db, userId, id))!;
    const run = (inv: InvoiceRow = invoice, profile: BusinessProfile = TEST_PROFILE, extra: Record<string, unknown> = {}) =>
      issueChecks(t.ctx, userId, inv, profile, { environment: "test", spec: TEST_SPEC, ...extra });
    return { t, cookie, userId, invoice, run };
  }

  const failing = (checks: Array<{ code: string; ok: boolean }>) => checks.filter((c) => !c.ok).map((c) => c.code);

  it("passes every check for a valid consumer receipt", async () => {
    const { run } = await passingCase();
    expect(failing(await run())).toEqual([]);
  });

  it("spec_verified: passes with the loaded, verified catalog", async () => {
    const { t, userId, invoice } = await passingCase();
    // Uses the real default SPEC (verified) rather than TEST_SPEC: every check passes.
    expect(failing(await issueChecks(t.ctx, userId, invoice, TEST_PROFILE, { environment: "test" }))).toEqual([]);
  });

  it("profile_complete: blocks without accountant review", async () => {
    const { run, invoice } = await passingCase();
    expect(failing(await run(invoice, { ...TEST_PROFILE, reviewed_by_accountant: false }))).toEqual(["profile_complete"]);
  });

  it("issuer_afm: blocks an invalid issuer AFM", async () => {
    const { run, invoice } = await passingCase();
    expect(failing(await run(invoice, { ...TEST_PROFILE, afm: "094014202" }))).toEqual(expect.arrayContaining(["issuer_afm", "profile_complete"]));
  });

  it("customer_afm: blocks a business document without a valid customer AFM", async () => {
    const { run, invoice } = await passingCase();
    const d = structuredClone(invoice.draft);
    d.customer = { ...d.customer, client_id: null, counterpart: "business", vat_number: "123456789" };
    d.document_type = TEST_PROFILE.document_types[1]!;
    expect(failing(await run({ ...invoice, draft: d }, TEST_PROFILE, { b2bProviderConfigured: true }))).toContain("customer_afm");
  });

  it("document_type_compatible: blocks types removed from the profile or mismatched to the customer", async () => {
    const { run, invoice } = await passingCase();
    const noType = { ...TEST_PROFILE, document_types: [TEST_PROFILE.document_types[1]!] };
    expect(failing(await run(invoice, noType))).toContain("document_type_compatible");
    const d = structuredClone(invoice.draft);
    d.customer.vat_number = "800123456";
    d.customer.client_id = null;
    expect(failing(await run({ ...invoice, draft: d }))).toContain("document_type_compatible");
  });

  it("required_fields: blocks missing descriptions and exemption codes", async () => {
    const { run, invoice } = await passingCase();
    const d = structuredClone(invoice.draft);
    d.lines[0]!.description = " ";
    d.lines[0]!.exemption_code = "";
    d.lines[0]!.vat_rate = "0";
    expect(failing(await run({ ...invoice, draft: d }))).toContain("required_fields");
  });

  it("totals_consistent: blocks tampered amounts", async () => {
    const { run, invoice } = await passingCase();
    const d = structuredClone(invoice.draft);
    d.calc.totals.vat = "15.49";
    expect(failing(await run({ ...invoice, draft: d }))).toEqual(["totals_consistent"]);
    const d2 = structuredClone(invoice.draft);
    d2.lines[0]!.amount = "81";
    expect(failing(await run({ ...invoice, draft: d2 }))).toEqual(["totals_consistent"]);
  });

  it("issue_date: blocks dates other than today", async () => {
    const { run, invoice } = await passingCase();
    expect(failing(await run(invoice, TEST_PROFILE, { issueDate: "2026-10-22" }))).toEqual(["issue_date"]);
    expect(failing(await run(invoice, TEST_PROFILE, { issueDate: "2026-10-01" }))).toEqual(["issue_date"]);
    expect(failing(await run(invoice, TEST_PROFILE, { issueDate: "garbage" }))).toEqual(["issue_date"]);
  });

  it("numbering: blocks while another document of the series is in flight, and reuses rejected numbers", async () => {
    const { run, invoice, userId } = await passingCase();
    const ins = (status: string, number: number) =>
      db.query(
        `insert into invoices (user_id, document_type_id, series, number, status, draft) values ($1, 'receipt', 'Α', $2, $3, '{}')`,
        [userId, number, status],
      );
    await ins("issued", 1);
    expect(await nextNumber(db, userId, "test", "receipt", "Α")).toBe(2);
    await ins("rejected", 2);
    expect(await nextNumber(db, userId, "test", "receipt", "Α")).toBe(2);
    await expect(ins("issued", 1)).rejects.toMatchObject({ code: "23505" });
    await ins("unknown", 2);
    expect(failing(await run(invoice))).toEqual(["numbering"]);
  });

  it("not_already_sent: blocks documents that are no longer drafts", async () => {
    const { run, invoice } = await passingCase();
    expect(failing(await run({ ...invoice, status: "issued" }))).toEqual(["not_already_sent"]);
  });

  it("environment: production stays disabled in this phase", async () => {
    const { t, userId, invoice } = await passingCase();
    await saveCredentials(t.ctx, userId, "prod", { username: "u", subscriptionKey: "key-123456" });
    expect(failing(await issueChecks(t.ctx, userId, invoice, TEST_PROFILE, { environment: "prod", spec: TEST_SPEC }))).toEqual(["environment"]);
  });

  it("credentials: blocks without myDATA credentials", async () => {
    const { t, run, invoice, cookie } = await passingCase();
    await call(t.app, "DELETE", "/api/aade/credentials/test", { cookie });
    expect(failing(await run(invoice))).toEqual(["credentials"]);
  });

  it("channel: business documents need a certified provider", async () => {
    const { t, cookie, userId } = await passingCase();
    await createClient(t, cookie, "Βήτα ΙΚΕ", "800123456");
    const c = await command(t, cookie, "Τιμολόγιο στη Βήτα ΙΚΕ 100 ευρώ πλέον ΦΠΑ για υπηρεσίες", invoiceCmd("Βήτα ΙΚΕ", "υπηρεσίες", "100 ευρώ", "πλέον ΦΠΑ"));
    const id = (await execute(t, cookie, c.transcript, c.preview)).json.invoiceId;
    const inv = (await getInvoice(db, userId, id))!;
    expect(failing(await issueChecks(t.ctx, userId, inv, TEST_PROFILE, { environment: "test", spec: TEST_SPEC }))).toEqual(["channel"]);
    expect(failing(await issueChecks(t.ctx, userId, inv, TEST_PROFILE, { environment: "test", spec: TEST_SPEC, b2bProviderConfigured: true }))).toEqual([]);
  });
});

describe("database protection of issued documents", () => {
  async function issuedRow() {
    const { t, cookie } = await setup();
    const userId = await userIdOf(t, cookie);
    const [row] = await db.query<{ id: string }>(
      `insert into invoices (user_id, document_type_id, series, number, status, draft, request_xml, mark)
       values ($1, 'receipt', 'Α', 1, 'issued', '{"x":1}', '<xml/>', 'MARK-TEST') returning id`,
      [userId],
    );
    return { t, cookie, id: row!.id };
  }

  it("rejects edits and deletion of issued documents", async () => {
    const { id } = await issuedRow();
    await expect(db.query("update invoices set draft = '{\"x\":2}' where id = $1", [id])).rejects.toThrow(/immutable|no longer a draft/);
    await expect(db.query("update invoices set mark = 'OTHER' where id = $1", [id])).rejects.toThrow(/immutable/);
    await expect(db.query("update invoices set request_xml = '<other/>' where id = $1", [id])).rejects.toThrow(/immutable/);
    await expect(db.query("update invoices set status = 'draft' where id = $1", [id])).rejects.toThrow(/immutable/);
    await expect(db.query("delete from invoices where id = $1", [id])).rejects.toThrow(/cannot be deleted/);
  });

  it("allows only cancellation", async () => {
    const { id } = await issuedRow();
    await db.query(`update invoices set status = 'cancelled', cancellation = '{"mark":"C-1"}', updated_at = now() where id = $1`, [id]);
    const [row] = await db.query<{ status: string; mark: string }>("select status, mark from invoices where id = $1", [id]);
    expect(row).toEqual({ status: "cancelled", mark: "MARK-TEST" });
  });

  it("blocks account deletion while issued documents exist", async () => {
    const { t, cookie } = await issuedRow();
    const res = await call(t.app, "POST", "/api/account/delete", { cookie, body: { password: "correct horse battery" } });
    expect(res.status).toBe(409);
    expect((await call(t.app, "GET", "/api/auth/me", { cookie })).status).toBe(200);
  });
});
