import type { BusinessProfile } from "../../src/invoicing/profile";
import type { SpecStatus } from "../../src/aade/spec";

/**
 * Test data only: real myDATA codes (so it validates against the loaded catalog),
 * with example rates and labels.
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
    { id: "std", label: "Κανονικός", rate: "24", aade_code: "1", exemption_code: "" },
    { id: "red", label: "Μειωμένος", rate: "13", aade_code: "2", exemption_code: "" },
    { id: "zero", label: "Απαλλαγή", rate: "0", aade_code: "7", exemption_code: "1" },
  ],
  default_vat_category_id: "std",
  document_types: [
    {
      id: "receipt",
      label: "Απόδειξη παροχής υπηρεσιών",
      aade_code: "11.2",
      counterpart: "consumer",
      series: "Α",
      income_classification_category: "category1_3",
      income_classification_type: "E3_561_003",
    },
    {
      id: "invoice",
      label: "Τιμολόγιο παροχής υπηρεσιών",
      aade_code: "2.1",
      counterpart: "business",
      series: "ΤΠΥ",
      income_classification_category: "category1_3",
      income_classification_type: "E3_561_003",
    },
  ],
  withholdings: [{ id: "wh", label: "Παρακράτηση φόρου", rate: "20", aade_code: "7", applies_to: "business_customers" }],
  catalog: [{ id: "piano", name: "Μάθημα πιάνου", unit_price: "30", price_basis: "with_vat", vat_category_id: "red" }],
  reviewed_by_accountant: true,
};

/** A verified catalog holding exactly the codes TEST_PROFILE uses. */
export const TEST_SPEC: SpecStatus = {
  version: "2.0.2",
  documentUrl: null,
  retrievedAt: null,
  verified: true,
  provenance: null,
  documentTypes: [
    { code: "11.2", label: "test", source: "test" },
    { code: "2.1", label: "test", source: "test" },
  ],
  vatCategories: [
    { code: "1", label: "test", source: "test" },
    { code: "2", label: "test", source: "test" },
    { code: "7", label: "test", source: "test" },
  ],
  vatExemptionCategories: [],
  incomeClassificationCategories: [],
  incomeClassificationTypes: [],
  withholdingCategories: [],
};
