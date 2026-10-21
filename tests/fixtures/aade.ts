import { calculate } from "../../src/invoicing/calc";
import type { DraftLine, InvoiceDraft } from "../../src/invoicing/invoices";
import { EMPTY_PROFILE, type BusinessProfile } from "../../src/invoicing/profile";

/**
 * Drafts built with the REAL myDATA codes (so the generated XML validates
 * against the official XSD). These are plausible example documents, not the
 * fake-code TEST_PROFILE used by the profile/check tests.
 */

export const ISSUER: BusinessProfile = { ...EMPTY_PROFILE, afm: "094014201", branch: "0", legal_name: "Δοκιμή" };

function line(over: Partial<DraftLine> = {}): DraftLine {
  return {
    description: "Μάθημα πιάνου",
    quantity: "1",
    amount: "100",
    amount_scope: "total",
    vat_rate: "24",
    vat_category_id: "std",
    vat_category_label: "ΦΠΑ 24%",
    vat_aade_code: "1",
    exemption_code: "",
    ...over,
  };
}

interface DraftOver {
  counterpart?: "business" | "consumer";
  vatNumber?: string | null;
  aadeDocCode?: string;
  lines?: DraftLine[];
  withholdings?: InvoiceDraft["withholdings"];
  priceBasis?: "with_vat" | "without_vat";
}

export function makeDraft(over: DraftOver = {}): InvoiceDraft {
  const counterpart = over.counterpart ?? "consumer";
  const lines = over.lines ?? [line()];
  const priceBasis = over.priceBasis ?? "without_vat";
  const withholdings = over.withholdings ?? [];
  const calc = calculate(lines, priceBasis, withholdings.map((w) => ({ label: w.label, rate: w.rate })));
  return {
    customer: {
      client_id: null,
      name: counterpart === "business" ? "Πελάτης ΑΕ" : "Μαρία",
      vat_number: "vatNumber" in over ? over.vatNumber ?? null : counterpart === "business" ? "123456789" : null,
      counterpart,
    },
    document_type: {
      id: "doc",
      label: counterpart === "business" ? "Τιμολόγιο Παροχής" : "ΑΠΥ",
      aade_code: over.aadeDocCode ?? (counterpart === "business" ? "2.1" : "11.2"),
      counterpart,
      series: "Α",
      income_classification_category: "category1_3",
      income_classification_type: "E3_561_003",
    },
    price_basis: priceBasis,
    lines,
    withholdings,
    calc,
  };
}

export { line as draftLine };
