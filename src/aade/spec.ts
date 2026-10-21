/**
 * Status of the official myDATA technical specification this code is built
 * against ("myDATA REST API για χρήστες ERP", aade.gr).
 *
 * Document type codes, VAT category codes, income classifications, rounding
 * rules, XML layout and endpoints must be taken from that document and its
 * XSD files, not from memory. Until they are loaded and verified, every
 * issuance is blocked by the `spec_verified` check.
 *
 * TODO(spec): download the latest official document and XSDs from aade.gr,
 * fill in the catalog below with references to the document sections, add
 * the XSDs under src/aade/xsd/<version>/, and set `verified` after review.
 */
export interface SpecCatalogEntry {
  code: string;
  label: string;
  /** Section/table of the official document the entry was copied from. */
  source: string;
}

export interface SpecStatus {
  version: string | null;
  documentUrl: string | null;
  retrievedAt: string | null;
  verified: boolean;
  documentTypes: SpecCatalogEntry[];
  vatCategories: SpecCatalogEntry[];
  vatExemptionCategories: SpecCatalogEntry[];
  incomeClassificationCategories: SpecCatalogEntry[];
  incomeClassificationTypes: SpecCatalogEntry[];
  withholdingCategories: SpecCatalogEntry[];
}

export const SPEC: SpecStatus = {
  // Latest version located on 2026-10-21 (not yet downloaded: aade.gr is unreachable from the build environment):
  // https://www.aade.gr/sites/default/files/2026-03/myDATA%20API%20Documentation%20v2.0.1_official_erp.pdf
  version: null,
  documentUrl: null,
  retrievedAt: null,
  verified: false,
  documentTypes: [],
  vatCategories: [],
  vatExemptionCategories: [],
  incomeClassificationCategories: [],
  incomeClassificationTypes: [],
  withholdingCategories: [],
};

export function specReady(spec: SpecStatus = SPEC): boolean {
  return spec.verified && spec.version !== null && spec.documentTypes.length > 0 && spec.vatCategories.length > 0;
}

/** True when a code entered in a profile exists in the loaded catalog (always false until the spec is loaded). */
export function inCatalog(list: SpecCatalogEntry[], code: string): boolean {
  return list.some((e) => e.code === code);
}
