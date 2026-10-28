import Decimal from "decimal.js";
import type { InvoiceDraft } from "../invoicing/invoices";

/**
 * Builds the myDATA `InvoicesDoc` XML (v2.0.2) for a single document from a
 * stored draft. Element order follows the official InvoicesDoc XSD exactly;
 * every generated document is validated against the XSD in the tests.
 *
 * Scope: the paths this application issues today — a sale/service invoice to a
 * business (counterpart with an AFM) or a retail document to a consumer (no
 * counterpart). Amounts come from the draft's own calculation (never
 * recomputed here), so the XML matches what the user confirmed.
 *
 * Not yet mapped (the builder throws rather than guess): more than one
 * withholding category on a document, fuel/delivery-note fields, foreign
 * counterparts, multiple income classifications per line. These need the
 * official document's prose and a sandbox round-trip before they are trusted.
 */

const INVOICE_NS = "http://www.aade.gr/myDATA/invoice/v1.0";
const ICLS_NS = "https://www.aade.gr/myDATA/incomeClassificaton/v1.0";

export interface IssuerInfo {
  /** Issuer AFM (9 digits). */
  afm: string;
  /** Establishment/branch number as registered with AADE ("0" for headquarters). */
  branch: string;
  /** ISO 3166-1 alpha-2; Greece for a domestic issuer. */
  country?: string;
}

export interface InvoiceXmlInput {
  issuer: IssuerInfo;
  draft: InvoiceDraft;
  series: string;
  /** Document number within the series. */
  aa: number;
  /** Issue date, YYYY-MM-DD (Europe/Athens). */
  issueDate: string;
  /** ISO 4217; EUR by default. */
  currency?: string;
  /**
   * Payment method (PaymentMethodType code, 1–8; e.g. 3 = cash, 7 = POS).
   * Mandatory for retail documents (myDATA error 204 otherwise); the amount is
   * the payable total. TODO(app): capture this from the user per document.
   */
  paymentMethod?: { type: string };
}

export class InvoiceXmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceXmlError";
  }
}

function esc(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

/** A tiny element writer that keeps the generated XML ordered and indented. */
class Xml {
  private parts: string[] = [];
  constructor(private indent = 0) {}
  private pad(): string {
    return "  ".repeat(this.indent);
  }
  /** Leaf element with text content. */
  leaf(name: string, value: string | number): void {
    this.parts.push(`${this.pad()}<${name}>${esc(String(value))}</${name}>`);
  }
  /** Container element whose body is written by `body`. */
  node(name: string, attrs: string, body: (x: Xml) => void): void {
    this.parts.push(`${this.pad()}<${name}${attrs}>`);
    const inner = new Xml(this.indent + 1);
    body(inner);
    this.parts.push(inner.toString());
    this.parts.push(`${this.pad()}</${name}>`);
  }
  toString(): string {
    return this.parts.join("\n");
  }
}

function d(value: string): Decimal {
  return new Decimal(value);
}

/** Per-line withholding amounts that sum exactly to the document withholding. */
function distributeWithholding(lineNets: string[], total: string): string[] {
  const totalNet = lineNets.reduce((acc, n) => acc.plus(n), new Decimal(0));
  const totalWh = d(total);
  if (totalNet.isZero()) return lineNets.map(() => "0.00");
  const shares = lineNets.map((n) => d(n).times(totalWh).dividedBy(totalNet).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
  // The last non-zero line absorbs the rounding remainder so the sum is exact.
  const allButLast = shares.slice(0, -1).reduce((acc, s) => acc.plus(s), new Decimal(0));
  shares[shares.length - 1] = totalWh.minus(allButLast);
  return shares.map((s) => s.toFixed(2));
}

export function buildInvoiceXml(input: InvoiceXmlInput): string {
  const { draft, issuer } = input;
  const calc = draft.calc;
  const country = issuer.country ?? "GR";
  const currency = input.currency ?? "EUR";

  if (!draft.document_type.aade_code) throw new InvoiceXmlError("document type AADE code is missing");
  if (!draft.document_type.income_classification_category || !draft.document_type.income_classification_type) {
    throw new InvoiceXmlError("income classification (category and type) is required");
  }
  if (calc.lines.length !== draft.lines.length) throw new InvoiceXmlError("calculation and draft lines are out of sync");
  if (draft.withholdings.length > 1) {
    throw new InvoiceXmlError("more than one withholding category is not mapped to XML yet");
  }

  const withholding = draft.withholdings[0];
  if (withholding && !withholding.aade_code) throw new InvoiceXmlError("withholding AADE code is missing");
  const lineWithheld = withholding ? distributeWithholding(calc.lines.map((l) => l.net), calc.totals.withholdings) : null;

  const incomeCategory = draft.document_type.income_classification_category;
  const incomeType = draft.document_type.income_classification_type;

  const root = new Xml(0);
  root.node("InvoicesDoc", ` xmlns="${INVOICE_NS}" xmlns:icls="${ICLS_NS}"`, (doc) => {
    doc.node("invoice", "", (inv) => {
      // Issuer.
      inv.node("issuer", "", (p) => {
        p.leaf("vatNumber", issuer.afm);
        p.leaf("country", country);
        p.leaf("branch", issuer.branch || "0");
      });
      // Counterpart only for a business customer (a consumer document carries none).
      if (draft.customer.counterpart === "business") {
        const vat = draft.customer.vat_number;
        if (!vat) throw new InvoiceXmlError("a business counterpart requires an AFM");
        inv.node("counterpart", "", (p) => {
          p.leaf("vatNumber", vat);
          p.leaf("country", "GR"); // TODO(spec): foreign counterparts carry their own country.
          p.leaf("branch", "0");
        });
      }
      // Header.
      inv.node("invoiceHeader", "", (h) => {
        h.leaf("series", input.series);
        h.leaf("aa", String(input.aa));
        h.leaf("issueDate", input.issueDate);
        h.leaf("invoiceType", draft.document_type.aade_code);
        h.leaf("currency", currency);
      });
      // Payment method (mandatory for retail documents). The amount is the payable total.
      if (input.paymentMethod) {
        inv.node("paymentMethods", "", (pm) => {
          pm.node("paymentMethodDetails", "", (det) => {
            det.leaf("type", input.paymentMethod!.type);
            det.leaf("amount", calc.totals.payable);
          });
        });
      }
      // One detail row per line. itemDescr is deliberately omitted: myDATA forbids
      // it for retail types (error 247), and AADE does not require it.
      calc.lines.forEach((cl, i) => {
        const dl = draft.lines[i]!;
        if (!dl.vat_aade_code) throw new InvoiceXmlError(`line ${i + 1}: VAT category AADE code is missing`);
        inv.node("invoiceDetails", "", (row) => {
          row.leaf("lineNumber", i + 1);
          row.leaf("netValue", cl.net);
          row.leaf("vatCategory", dl.vat_aade_code);
          row.leaf("vatAmount", cl.vat);
          // Exemption reason is required by the schema use when the line carries no VAT.
          if (d(cl.vat).isZero() && dl.exemption_code) row.leaf("vatExemptionCategory", dl.exemption_code);
          if (withholding && lineWithheld) {
            row.leaf("withheldAmount", lineWithheld[i]!);
            row.leaf("withheldPercentCategory", withholding.aade_code);
          }
          row.node("incomeClassification", "", (ic) => {
            ic.leaf("icls:classificationType", incomeType);
            ic.leaf("icls:classificationCategory", incomeCategory);
            ic.leaf("icls:amount", cl.net);
          });
        });
      });
      // Summary. Gross is net + VAT; withholding is reported separately, not subtracted here.
      inv.node("invoiceSummary", "", (s) => {
        s.leaf("totalNetValue", calc.totals.net);
        s.leaf("totalVatAmount", calc.totals.vat);
        s.leaf("totalWithheldAmount", calc.totals.withholdings);
        s.leaf("totalFeesAmount", "0.00");
        s.leaf("totalStampDutyAmount", "0.00");
        s.leaf("totalOtherTaxesAmount", "0.00");
        s.leaf("totalDeductionsAmount", "0.00");
        s.leaf("totalGrossValue", calc.totals.gross);
        // All lines share one income classification, so the summary holds a single aggregated entry.
        s.node("incomeClassification", "", (ic) => {
          ic.leaf("icls:classificationType", incomeType);
          ic.leaf("icls:classificationCategory", incomeCategory);
          ic.leaf("icls:amount", calc.totals.net);
        });
      });
    });
  });

  return `<?xml version="1.0" encoding="UTF-8"?>\n${root.toString()}\n`;
}
