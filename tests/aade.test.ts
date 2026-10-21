import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { SPEC, specReady, inCatalog } from "../src/aade/spec";
import { buildInvoiceXml, InvoiceXmlError } from "../src/aade/xml";
import { validateXml } from "../src/aade/validate";
import { parseResponseDoc, isSuccess } from "../src/aade/response";
import { sendInvoices, cancelInvoice } from "../src/aade/client";
import type { AadeCredentials } from "../src/aade/credentials";
import { ISSUER, makeDraft, draftLine } from "./fixtures/aade";

const XSD_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "aade", "xsd", "v2.0.2");
function xsdEnum(file: string, type: string): Set<string> {
  const xsd = readFileSync(join(XSD_DIR, file), "utf8");
  const block = xsd.match(new RegExp(`<xs:simpleType name="${type}">([\\s\\S]*?)</xs:simpleType>`))?.[1] ?? "";
  return new Set([...block.matchAll(/<xs:enumeration value="([^"]+)"/g)].map((m) => m[1]!));
}

const creds: AadeCredentials = { username: "user-1", subscriptionKey: "key-123456" };

function fetchReturning(status: number, body: string, captured?: { url?: string; headers?: Record<string, string>; body?: string }): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    if (captured) {
      captured.url = String(input);
      captured.headers = init?.headers as Record<string, string>;
      captured.body = typeof init?.body === "string" ? init.body : "";
    }
    return new Response(body, { status });
  }) as typeof fetch;
}

describe("myDATA spec catalog", () => {
  it("is loaded but stays unverified so issuance remains locked", () => {
    expect(SPEC.version).toBe("2.0.2");
    expect(SPEC.verified).toBe(false);
    expect(specReady()).toBe(false);
    expect(SPEC.documentTypes.length).toBeGreaterThan(0);
  });

  it("has the expected catalog sizes", () => {
    expect(SPEC.vatCategories).toHaveLength(10);
    expect(SPEC.vatExemptionCategories).toHaveLength(31);
    expect(SPEC.withholdingCategories).toHaveLength(18);
    expect(SPEC.incomeClassificationCategories.length).toBeGreaterThan(0);
    expect(SPEC.incomeClassificationTypes.length).toBeGreaterThan(0);
  });

  it("only uses codes that exist in the official XSD enumerations", () => {
    const docTypes = xsdEnum("SimpleTypes-v2.0.2.xsd", "InvoiceType");
    for (const e of SPEC.documentTypes) expect(docTypes.has(e.code), `doc type ${e.code}`).toBe(true);
    const incomeTypes = xsdEnum("SimpleTypes-v2.0.2.xsd", "IncomeClassificationValueType");
    for (const e of SPEC.incomeClassificationTypes) expect(incomeTypes.has(e.code), `income type ${e.code}`).toBe(true);
    const incomeCats = xsdEnum("SimpleTypes-v2.0.2.xsd", "IncomeClassificationCategoryType");
    for (const e of SPEC.incomeClassificationCategories) expect(incomeCats.has(e.code), `income cat ${e.code}`).toBe(true);
  });

  it("inCatalog recognizes known and unknown codes", () => {
    expect(inCatalog(SPEC.vatCategories, "1")).toBe(true);
    expect(inCatalog(SPEC.vatCategories, "999")).toBe(false);
  });
});

describe("InvoicesDoc XML generation", () => {
  const opts = { series: "Α", aa: 1, issueDate: "2026-10-21" };

  it("builds a valid consumer document with no counterpart", async () => {
    const xml = buildInvoiceXml({ issuer: ISSUER, draft: makeDraft({ counterpart: "consumer" }), ...opts });
    expect((await validateXml(xml)).errors).toEqual([]);
    expect(xml).toContain("<invoiceType>11.2</invoiceType>");
    expect(xml).not.toContain("<counterpart>");
    expect(xml).toContain("<icls:classificationType>E3_561_003</icls:classificationType>");
  });

  it("builds a valid business document with a counterpart AFM", async () => {
    const xml = buildInvoiceXml({ issuer: ISSUER, draft: makeDraft({ counterpart: "business", vatNumber: "123456789" }), ...opts });
    const res = await validateXml(xml);
    expect(res.valid).toBe(true);
    expect(xml).toContain("<counterpart>");
    expect(xml).toContain("<vatNumber>123456789</vatNumber>");
  });

  it("emits a VAT exemption category for a 0% line and validates", async () => {
    const zero = draftLine({ vat_rate: "0", vat_aade_code: "7", exemption_code: "1", vat_category_label: "Άνευ ΦΠΑ" });
    const xml = buildInvoiceXml({ issuer: ISSUER, draft: makeDraft({ lines: [zero] }), ...opts });
    expect((await validateXml(xml)).valid).toBe(true);
    expect(xml).toContain("<vatExemptionCategory>1</vatExemptionCategory>");
  });

  it("distributes a single withholding across lines so the parts sum to the total", async () => {
    const draft = makeDraft({
      counterpart: "business",
      lines: [draftLine({ amount: "100" }), draftLine({ amount: "33.33" })],
      withholdings: [{ id: "w", label: "Παροχή Υπηρεσιών 8%", rate: "8", aade_code: "7", applies_to: "all" }],
    });
    const xml = buildInvoiceXml({ issuer: ISSUER, draft, ...opts });
    expect((await validateXml(xml)).valid).toBe(true);
    expect(xml).toContain("<withheldPercentCategory>7</withheldPercentCategory>");
    const parts = [...xml.matchAll(/<withheldAmount>([\d.]+)<\/withheldAmount>/g)].map((m) => new Decimal(m[1]!));
    const sum = parts.reduce((a, b) => a.plus(b), new Decimal(0));
    expect(sum.toFixed(2)).toBe(draft.calc.totals.withholdings);
  });

  it("refuses more than one withholding category", () => {
    const draft = makeDraft({
      withholdings: [
        { id: "a", label: "A", rate: "8", aade_code: "7", applies_to: "all" },
        { id: "b", label: "B", rate: "20", aade_code: "2", applies_to: "all" },
      ],
    });
    expect(() => buildInvoiceXml({ issuer: ISSUER, draft, ...opts })).toThrow(InvoiceXmlError);
  });

  it("refuses a business document without a counterpart AFM", () => {
    const draft = makeDraft({ counterpart: "business", vatNumber: null });
    expect(() => buildInvoiceXml({ issuer: ISSUER, draft, ...opts })).toThrow(InvoiceXmlError);
  });
});

describe("ResponseDoc parsing", () => {
  const success = `<?xml version="1.0" encoding="UTF-8"?>
<ResponseDoc><response><index>1</index><invoiceUid>UID-1</invoiceUid><invoiceMark>400000001</invoiceMark><qrUrl>https://x/qr</qrUrl><statusCode>Success</statusCode></response></ResponseDoc>`;
  const failure = `<?xml version="1.0" encoding="UTF-8"?>
<ResponseDoc><response><index>1</index><errors><error><message>Λάθος ΑΦΜ</message><code>102</code></error></errors><statusCode>ValidationError</statusCode></response></ResponseDoc>`;

  it("reads a success response", () => {
    const doc = parseResponseDoc(success);
    expect(isSuccess(doc)).toBe(true);
    expect(doc.responses[0]!.invoiceMark).toBe("400000001");
    expect(doc.responses[0]!.invoiceUid).toBe("UID-1");
  });

  it("reads a failure response with errors", () => {
    const doc = parseResponseDoc(failure);
    expect(isSuccess(doc)).toBe(false);
    expect(doc.responses[0]!.errors).toEqual([{ message: "Λάθος ΑΦΜ", code: "102" }]);
  });

  it("validates both sample responses against the response XSD", async () => {
    expect((await validateXml(success, "response-v2.0.2.xsd")).valid).toBe(true);
    expect((await validateXml(failure, "response-v2.0.2.xsd")).valid).toBe(true);
  });
});

describe("AADE client", () => {
  const successXml = "<ResponseDoc><response><invoiceUid>U1</invoiceUid><invoiceMark>9001</invoiceMark><statusCode>Success</statusCode></response></ResponseDoc>";
  const errorXml = "<ResponseDoc><response><errors><error><message>bad</message><code>102</code></error></errors><statusCode>ValidationError</statusCode></response></ResponseDoc>";

  it("sends to the test endpoint with the credential headers", async () => {
    const captured: { url?: string; headers?: Record<string, string>; body?: string } = {};
    const res = await sendInvoices({ environment: "test", credentials: creds, fetchImpl: fetchReturning(200, successXml, captured) }, "<xml/>");
    expect(captured.url).toBe("https://mydataapidev.aade.gr/SendInvoices");
    expect(captured.headers!["aade-user-id"]).toBe("user-1");
    expect(captured.headers!["ocp-apim-subscription-key"]).toBe("key-123456");
    expect(captured.body).toBe("<xml/>");
    expect(res.outcome).toBe("issued");
    expect(res.mark).toBe("9001");
    expect(res.uid).toBe("U1");
  });

  it("maps an error response to a rejection", async () => {
    const res = await sendInvoices({ environment: "test", credentials: creds, fetchImpl: fetchReturning(200, errorXml) }, "<xml/>");
    expect(res.outcome).toBe("rejected");
    expect(res.errors[0]!.code).toBe("102");
  });

  it("maps a network error to unknown", async () => {
    const boom = (async () => {
      throw new Error("ECONNRESET");
    }) as typeof fetch;
    const res = await sendInvoices({ environment: "test", credentials: creds, fetchImpl: boom }, "<xml/>");
    expect(res.outcome).toBe("unknown");
  });

  it("maps a timeout (AbortError) to unknown", async () => {
    const abort = (async () => {
      const e = new Error("aborted");
      e.name = "AbortError";
      throw e;
    }) as typeof fetch;
    const res = await sendInvoices({ environment: "test", credentials: creds, fetchImpl: abort }, "<xml/>");
    expect(res.outcome).toBe("unknown");
  });

  it("maps a 401 without a response document to a rejection", async () => {
    const res = await sendInvoices({ environment: "test", credentials: creds, fetchImpl: fetchReturning(401, "Unauthorized") }, "<xml/>");
    expect(res.outcome).toBe("rejected");
    expect(res.errors[0]!.code).toBe("401");
  });

  it("cancels by mark on the test endpoint", async () => {
    const cancelXml = "<ResponseDoc><response><cancellationMark>7777</cancellationMark><statusCode>Success</statusCode></response></ResponseDoc>";
    const captured: { url?: string } = {};
    const res = await cancelInvoice({ environment: "test", credentials: creds, fetchImpl: fetchReturning(200, cancelXml, captured) }, "9001");
    expect(captured.url).toBe("https://mydataapidev.aade.gr/CancelInvoice?mark=9001");
    expect(res.cancellationMark).toBe("7777");
  });
});
