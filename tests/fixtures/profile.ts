import type { BusinessProfile } from "../../src/invoicing/profile";
import type { SpecStatus } from "../../src/aade/spec";

/**
 * Test data only. All AADE codes here are deliberately fake ("TEST-…") and are
 * NOT the official myDATA codes; rates are example values.
 */
export const TEST_PROFILE: BusinessProfile = {
  afm: "094014201",
  legal_name: "Δοκιμαστική Επιχείρηση",
  trade_name: "",
  doy: "Α' Αθηνών",
  address: { street: "Οδός Δοκιμής", number: "1", postal_code: "10558", city: "Αθήνα" },
  activity: "Παροχή υπηρεσιών (δοκιμή)",
  branch: "0",
  vat_regime: "normal",
  vat_categories: [
    { id: "std", label: "Κανονικός", rate: "24", aade_code: "TEST-VAT-1", exemption_code: "" },
    { id: "red", label: "Μειωμένος", rate: "13", aade_code: "TEST-VAT-2", exemption_code: "" },
    { id: "zero", label: "Απαλλαγή", rate: "0", aade_code: "TEST-VAT-0", exemption_code: "TEST-EX-1" },
  ],
  default_vat_category_id: "std",
  document_types: [
    {
      id: "receipt",
      label: "Απόδειξη παροχής υπηρεσιών",
      aade_code: "TEST-DOC-R",
      counterpart: "consumer",
      series: "Α",
      income_classification_category: "TEST-IC-CAT",
      income_classification_type: "TEST-IC-TYPE",
    },
    {
      id: "invoice",
      label: "Τιμολόγιο παροχής υπηρεσιών",
      aade_code: "TEST-DOC-I",
      counterpart: "business",
      series: "ΤΠΥ",
      income_classification_category: "TEST-IC-CAT",
      income_classification_type: "TEST-IC-TYPE",
    },
  ],
  withholdings: [{ id: "wh", label: "Παρακράτηση φόρου", rate: "20", aade_code: "TEST-WH-1", applies_to: "business_customers" }],
  catalog: [{ id: "piano", name: "Μάθημα πιάνου", unit_price: "30", price_basis: "with_vat", vat_category_id: "red" }],
  reviewed_by_accountant: true,
};

/** A fake "verified" catalog that recognizes only the fake codes above. */
export const TEST_SPEC: SpecStatus = {
  version: "TEST-0.0",
  documentUrl: null,
  retrievedAt: null,
  verified: true,
  provenance: null,
  documentTypes: [
    { code: "TEST-DOC-R", label: "test", source: "test" },
    { code: "TEST-DOC-I", label: "test", source: "test" },
  ],
  vatCategories: [
    { code: "TEST-VAT-1", label: "test", source: "test" },
    { code: "TEST-VAT-2", label: "test", source: "test" },
    { code: "TEST-VAT-0", label: "test", source: "test" },
  ],
  vatExemptionCategories: [],
  incomeClassificationCategories: [],
  incomeClassificationTypes: [],
  withholdingCategories: [],
};
