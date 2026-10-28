import { describe, it, expect } from "vitest";
import { buildInvoiceXml } from "../src/aade/xml";
import { calculate } from "../src/invoicing/calc";
import { parseResponseDoc, isSuccess } from "../src/aade/response";
import type { DraftLine, InvoiceDraft } from "../src/invoicing/invoices";

/**
 * Live integration test against the myDATA DEV (sandbox) environment. Opt-in and
 * off by default: it needs real test credentials and network access.
 *
 * Run it with:
 *   npm run test:sandbox
 * which sets NODE_USE_ENV_PROXY=1 (so Node's fetch goes through the agent proxy
 * that injects the aade-user-id / ocp-apim-subscription-key headers configured as
 * a Network secret) and MYDATA_SANDBOX=1. The full issue/cancel case also needs
 * MYDATA_TEST_AFM set to the AFM the credentials belong to (the issuer VAT number
 * must match the account, myDATA error 105).
 */
const ENABLED = process.env.MYDATA_SANDBOX === "1";
const AFM = process.env.MYDATA_TEST_AFM;
const BASE = "https://mydataapidev.aade.gr";

describe.runIf(ENABLED)("myDATA sandbox (live)", () => {
  it("authenticates against a read-only endpoint", async () => {
    const res = await fetch(`${BASE}/RequestTransmittedDocs?mark=1`, { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("RequestedDoc");
  });

  it.runIf(AFM)("issues a retail receipt the sandbox accepts, then cancels it", async () => {
    const lines: DraftLine[] = [{
      description: "Δοκιμαστική υπηρεσία", quantity: "1", amount: "100", amount_scope: "total",
      vat_rate: "24", vat_category_id: "std", vat_category_label: "ΦΠΑ 24%", vat_aade_code: "1", exemption_code: "",
    }];
    const calc = calculate(lines, "without_vat", []);
    const draft: InvoiceDraft = {
      customer: { client_id: null, name: "Ιδιώτης", vat_number: null, counterpart: "consumer" },
      document_type: { id: "apy", label: "ΑΠΥ", aade_code: "11.2", counterpart: "consumer", series: "A",
        income_classification_category: "category1_3", income_classification_type: "E3_561_003" },
      price_basis: "without_vat", lines, withholdings: [], calc,
    };
    const today = new Date().toISOString().slice(0, 10);
    // A unique number per run: myDATA never accepts the same series+number twice,
    // not even after a cancellation. Date.now() fits the aa field (string, ≤50).
    const xml = buildInvoiceXml({ issuer: { afm: AFM!, branch: "0" }, draft, series: "A", aa: Date.now(), issueDate: today, paymentMethod: { type: "3" } });

    const send = await fetch(`${BASE}/SendInvoices`, { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8" }, body: xml });
    expect(send.status).toBe(200);
    const sent = parseResponseDoc(await send.text());
    expect(isSuccess(sent), JSON.stringify(sent.responses[0]?.errors)).toBe(true);
    const mark = sent.responses[0]!.invoiceMark;
    expect(mark).toBeTruthy();

    // A just-registered mark is not immediately cancellable (myDATA error 301,
    // "not found"), so retry briefly until the sandbox has indexed it.
    let cancelBody = "";
    let ok = false;
    for (let attempt = 0; attempt < 5 && !ok; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
      const cancel = await fetch(`${BASE}/CancelInvoice?mark=${mark}`, { method: "POST" });
      expect(cancel.status).toBe(200);
      cancelBody = await cancel.text();
      const doc = parseResponseDoc(cancelBody);
      ok = isSuccess(doc);
      // Stop early on any error other than "not found yet".
      if (!ok && !doc.responses.some((r) => r.errors.some((e) => e.code === "301"))) break;
    }
    expect(ok, cancelBody).toBe(true);
  }, 30_000);
});
