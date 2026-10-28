/**
 * The official myDATA technical specification this code is built against
 * ("myDATA REST API για χρήστες ERP", aade.gr), version 2.0.2.
 *
 * Document type codes, VAT category codes, income classifications, exemption
 * reasons and withholding categories are taken from that specification and its
 * XSD files, never from memory. The code sets below are the enumerations of the
 * official v2.0.2 XSDs; the human labels are the matching rows of the official
 * documentation's appendix tables.
 *
 * Provenance: the aade.gr site was unreachable from the build environment
 * (Akamai returns 403 to it), so the XSDs under ./xsd/v2.0.2/ and the labels
 * below were taken from the `firebed/aade-mydata` v2.0.2 mirror of the official
 * files (see ./xsd/v2.0.2/PROVENANCE.md).
 *
 * `verified` controls the `spec_verified` issuance check. It was set to true on
 * 2026-10-28 after an accountant confirmed the tax rules and the real myDATA
 * sandbox accepted a document built from this catalog. A direct diff against the
 * files on aade.gr is still worthwhile; set it back to false if that surfaces a
 * discrepancy, which re-locks every issuance.
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
  /** How the catalog and XSDs were obtained; shown to no one, kept for auditing. */
  provenance: string | null;
  documentTypes: SpecCatalogEntry[];
  vatCategories: SpecCatalogEntry[];
  vatExemptionCategories: SpecCatalogEntry[];
  incomeClassificationCategories: SpecCatalogEntry[];
  incomeClassificationTypes: SpecCatalogEntry[];
  withholdingCategories: SpecCatalogEntry[];
}

/** myDATA document types (InvoiceType, SimpleTypes-v2.0.2.xsd), official appendix labels. */
const DOCUMENT_TYPES: SpecCatalogEntry[] = [
  { code: "1.1", label: "Τιμολόγιο Πώλησης", source: "Είδη Παραστατικών §1" },
  { code: "1.2", label: "Τιμολόγιο Πώλησης / Ενδοκοινοτικές Παραδόσεις", source: "Είδη Παραστατικών §1" },
  { code: "1.3", label: "Τιμολόγιο Πώλησης / Παραδόσεις Τρίτων Χωρών", source: "Είδη Παραστατικών §1" },
  { code: "1.4", label: "Τιμολόγιο Πώλησης / Πώληση για Λογαριασμό Τρίτων", source: "Είδη Παραστατικών §1" },
  { code: "1.5", label: "Τιμολόγιο Πώλησης / Εκκαθάριση Πωλήσεων Τρίτων - Αμοιβή από Πωλήσεις Τρίτων", source: "Είδη Παραστατικών §1" },
  { code: "1.6", label: "Τιμολόγιο Πώλησης / Συμπληρωματικό Παραστατικό", source: "Είδη Παραστατικών §1" },
  { code: "2.1", label: "Τιμολόγιο Παροχής", source: "Είδη Παραστατικών §2" },
  { code: "2.2", label: "Τιμολόγιο Παροχής / Ενδοκοινοτική Παροχή Υπηρεσιών", source: "Είδη Παραστατικών §2" },
  { code: "2.3", label: "Τιμολόγιο Παροχής / Παροχή Υπηρεσιών σε λήπτη Τρίτης Χώρας", source: "Είδη Παραστατικών §2" },
  { code: "2.4", label: "Τιμολόγιο Παροχής / Συμπληρωματικό Παραστατικό", source: "Είδη Παραστατικών §2" },
  { code: "3.1", label: "Τίτλος Κτήσης (μη υπόχρεος Εκδότης)", source: "Είδη Παραστατικών §3" },
  { code: "3.2", label: "Τίτλος Κτήσης (άρνηση έκδοσης από υπόχρεο Εκδότη)", source: "Είδη Παραστατικών §3" },
  { code: "5.1", label: "Πιστωτικό Τιμολόγιο / Συσχετιζόμενο", source: "Είδη Παραστατικών §5" },
  { code: "5.2", label: "Πιστωτικό Τιμολόγιο / Μη Συσχετιζόμενο", source: "Είδη Παραστατικών §5" },
  { code: "6.1", label: "Στοιχείο Αυτοπαράδοσης", source: "Είδη Παραστατικών §6" },
  { code: "6.2", label: "Στοιχείο Ιδιοχρησιμοποίησης", source: "Είδη Παραστατικών §6" },
  { code: "7.1", label: "Συμβόλαιο - Έσοδο", source: "Είδη Παραστατικών §7" },
  { code: "8.1", label: "Ενοίκια - Έσοδο", source: "Είδη Παραστατικών §8" },
  { code: "8.2", label: "Τέλος ανθεκτικότητας κλιματικής κρίσης", source: "Είδη Παραστατικών §8" },
  { code: "8.4", label: "Απόδειξη Είσπραξης POS", source: "Είδη Παραστατικών §8" },
  { code: "8.5", label: "Απόδειξη Επιστροφής POS", source: "Είδη Παραστατικών §8" },
  { code: "8.6", label: "Δελτίο Παραγγελίας Εστίασης", source: "Είδη Παραστατικών §8" },
  { code: "9.1", label: "Δελτίο Αποστολής Συσχετιζόμενο", source: "Είδη Παραστατικών §9" },
  { code: "9.2", label: "Συγκεντρωτικό Δελτίο Αποστολής", source: "Είδη Παραστατικών §9" },
  { code: "9.3", label: "Παραστατικό Διακίνησης Μη Συσχετιζόμενο", source: "Είδη Παραστατικών §9" },
  { code: "10.1", label: "Δελτίο Ποσοτικής Παραλαβής Συσχετιζόμενο", source: "Είδη Παραστατικών §10" },
  { code: "10.2", label: "Δελτίο Ποσοτικής Παραλαβής Μη Συσχετιζόμενο", source: "Είδη Παραστατικών §10" },
  { code: "11.1", label: "ΑΛΠ", source: "Είδη Παραστατικών §11" },
  { code: "11.2", label: "ΑΠΥ", source: "Είδη Παραστατικών §11" },
  { code: "11.3", label: "Απλοποιημένο Τιμολόγιο", source: "Είδη Παραστατικών §11" },
  { code: "11.4", label: "Πιστωτικό Στοιχείο Λιανικής", source: "Είδη Παραστατικών §11" },
  { code: "11.5", label: "Απόδειξη Λιανικής Πώλησης για Λογ/σμό Τρίτων", source: "Είδη Παραστατικών §11" },
  { code: "13.1", label: "Έξοδα - Αγορές Λιανικών Συναλλαγών ημεδαπής / αλλοδαπής", source: "Είδη Παραστατικών §13" },
  { code: "13.2", label: "Παροχή Λιανικών Συναλλαγών ημεδαπής / αλλοδαπής", source: "Είδη Παραστατικών §13" },
  { code: "13.3", label: "Κοινόχρηστα", source: "Είδη Παραστατικών §13" },
  { code: "13.4", label: "Συνδρομές", source: "Είδη Παραστατικών §13" },
  { code: "13.30", label: "Παραστατικά Οντότητας ως Αναγράφονται από την ίδια (Δυναμικό)", source: "Είδη Παραστατικών §13" },
  { code: "13.31", label: "Πιστωτικό Στοιχείο Λιανικής ημεδαπής / αλλοδαπής", source: "Είδη Παραστατικών §13" },
  { code: "14.1", label: "Τιμολόγιο / Ενδοκοινοτικές Αποκτήσεις", source: "Είδη Παραστατικών §14" },
  { code: "14.2", label: "Τιμολόγιο / Αποκτήσεις Τρίτων Χωρών / αλλοδαπής", source: "Είδη Παραστατικών §14" },
  { code: "14.3", label: "Τιμολόγιο / Ενδοκοινοτική Λήψη Υπηρεσιών", source: "Είδη Παραστατικών §14" },
  { code: "14.4", label: "Τιμολόγιο / Λήψη Υπηρεσιών Τρίτων Χωρών", source: "Είδη Παραστατικών §14" },
  { code: "14.5", label: "ΕΦΚΑ και λοιποί Ασφαλιστικοί Οργανισμοί (Δυναμικό)", source: "Είδη Παραστατικών §14" },
  { code: "14.30", label: "Παραστατικά Οντότητας ως Αναγράφονται από την ίδια (Δυναμικό) / αλλοδαπής", source: "Είδη Παραστατικών §14" },
  { code: "14.31", label: "Πιστωτικό ημεδαπής / αλλοδαπής", source: "Είδη Παραστατικών §14" },
  { code: "15.1", label: "Συμβόλαιο - Έξοδο", source: "Είδη Παραστατικών §15" },
  { code: "16.1", label: "Ενοίκιο Έξοδο", source: "Είδη Παραστατικών §16" },
  { code: "17.1", label: "Μισθοδοσία", source: "Είδη Παραστατικών §17" },
  { code: "17.2", label: "Αποσβέσεις", source: "Είδη Παραστατικών §17" },
  { code: "17.3", label: "Λοιπές Εγγραφές Τακτοποίησης Εσόδων - Λογιστική Βάση", source: "Είδη Παραστατικών §17" },
  { code: "17.4", label: "Λοιπές Εγγραφές Τακτοποίησης Εσόδων - Φορολογική Βάση", source: "Είδη Παραστατικών §17" },
  { code: "17.5", label: "Λοιπές Εγγραφές Τακτοποίησης Εξόδων - Λογιστική Βάση", source: "Είδη Παραστατικών §17" },
  { code: "17.6", label: "Λοιπές Εγγραφές Τακτοποίησης Εξόδων - Φορολογική Βάση", source: "Είδη Παραστατικών §17" },
];

/** VAT categories (VatType 1..10). The percentage rate is part of the label. */
const VAT_CATEGORIES: SpecCatalogEntry[] = [
  { code: "1", label: "ΦΠΑ συντελεστής 24%", source: "Κατηγορίες Φ.Π.Α." },
  { code: "2", label: "ΦΠΑ συντελεστής 13%", source: "Κατηγορίες Φ.Π.Α." },
  { code: "3", label: "ΦΠΑ συντελεστής 6%", source: "Κατηγορίες Φ.Π.Α." },
  { code: "4", label: "ΦΠΑ συντελεστής 17%", source: "Κατηγορίες Φ.Π.Α." },
  { code: "5", label: "ΦΠΑ συντελεστής 9%", source: "Κατηγορίες Φ.Π.Α." },
  { code: "6", label: "ΦΠΑ συντελεστής 4%", source: "Κατηγορίες Φ.Π.Α." },
  { code: "7", label: "Άνευ Φ.Π.Α. 0%", source: "Κατηγορίες Φ.Π.Α." },
  { code: "8", label: "Εγγραφές χωρίς ΦΠΑ (πχ Μισθοδοσία, Αποσβέσεις)", source: "Κατηγορίες Φ.Π.Α." },
  { code: "9", label: "ΦΠΑ συντελεστής 3% (αρ.31 ν.5057/2023)", source: "Κατηγορίες Φ.Π.Α." },
  { code: "10", label: "ΦΠΑ συντελεστής 4% (αρ.31 ν.5057/2023)", source: "Κατηγορίες Φ.Π.Α." },
];

/** VAT exemption reasons (VatExemptionType 1..31, ν. 5144/2024). */
const VAT_EXEMPTION_CATEGORIES: SpecCatalogEntry[] = [
  { code: "1", label: "Χωρίς ΦΠΑ - άρθρο 2 και 3 του Κώδικα ΦΠΑ", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "2", label: "Χωρίς ΦΠΑ - άρθρο 5 του Κώδικα ΦΠΑ", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "3", label: "Χωρίς ΦΠΑ - άρθρο 17 του Κώδικα ΦΠΑ", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "4", label: "Χωρίς ΦΠΑ - άρθρο 18 του Κώδικα ΦΠΑ", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "5", label: "Χωρίς ΦΠΑ - άρθρο 21 του Κώδικα ΦΠΑ", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "6", label: "Χωρίς ΦΠΑ - άρθρο 24 του Κώδικα ΦΠΑ", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "7", label: "Χωρίς ΦΠΑ - άρθρο 27 του Κώδικα ΦΠΑ", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "8", label: "Χωρίς ΦΠΑ - άρθρο 29 του Κώδικα ΦΠΑ", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "9", label: "Χωρίς ΦΠΑ - άρθρο 30 του Κώδικα ΦΠΑ", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "10", label: "Χωρίς ΦΠΑ - άρθρο 31 του Κώδικα ΦΠΑ", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "11", label: "Χωρίς ΦΠΑ - άρθρο 32 του Κώδικα ΦΠΑ", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "12", label: "Χωρίς ΦΠΑ - άρθρο 32 του Κώδικα ΦΠΑ - Πλοία Ανοικτής Θαλάσσης", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "13", label: "Χωρίς ΦΠΑ - άρθρο 32 .1.γ. του Κώδικα ΦΠΑ - Πλοία Ανοικτής Θαλάσσης", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "14", label: "Χωρίς ΦΠΑ - άρθρο 33 του Κώδικα ΦΠΑ", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "15", label: "Χωρίς ΦΠΑ - άρθρο 44 του Κώδικα ΦΠΑ", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "16", label: "Χωρίς ΦΠΑ - άρθρο 45 του Κώδικα ΦΠΑ", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "17", label: "Χωρίς ΦΠΑ - άρθρο 47 του Κώδικα ΦΠΑ", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "18", label: "Χωρίς ΦΠΑ - άρθρο 48 του Κώδικα ΦΠΑ", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "19", label: "Χωρίς ΦΠΑ - άρθρο 54 του Κώδικα ΦΠΑ", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "20", label: "ΦΠΑ εμπεριεχόμενος - άρθρο 50 του Κώδικα ΦΠΑ", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "21", label: "ΦΠΑ εμπεριεχόμενος - άρθρο 51 του Κώδικα ΦΠΑ", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "22", label: "ΦΠΑ εμπεριεχόμενος - άρθρο 52 του Κώδικα ΦΠΑ", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "23", label: "ΦΠΑ εμπεριεχόμενος - άρθρο 53 του Κώδικα ΦΠΑ", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "24", label: "Χωρίς ΦΠΑ - άρθρο 8 του Κώδικα ΦΠΑ", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "25", label: "Χωρίς ΦΠΑ - ΠΟΛ.1029/1995", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "26", label: "Χωρίς ΦΠΑ - ΠΟΛ.1167/2015", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "27", label: "Λοιπές Εξαιρέσεις ΦΠΑ", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "28", label: "Χωρίς ΦΠΑ – άρθρο 29 περ. β’ παρ.1 του Κώδικα ΦΠΑ, (Tax Free)", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "29", label: "Χωρίς ΦΠΑ – άρθρο 56 του Κώδικα ΦΠΑ (OSS μη ενωσιακό καθεστώς)", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "30", label: "Χωρίς ΦΠΑ – άρθρο 57 του Κώδικα ΦΠΑ (OSS ενωσιακό καθεστώς)", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
  { code: "31", label: "Χωρίς ΦΠΑ – άρθρο 58 του Κώδικα ΦΠΑ (IOSS)", source: "Κατηγορίες Αιτίας Εξαίρεσης ΦΠΑ" },
];

/** Income classification categories (IncomeClassificationCategoryType). */
const INCOME_CLASSIFICATION_CATEGORIES: SpecCatalogEntry[] = [
  { code: "category1_1", label: "Έσοδα από Πώληση Εμπορευμάτων", source: "Χαρακτηρισμοί Εσόδων / Κατηγορία" },
  { code: "category1_2", label: "Έσοδα από Πώληση Προϊόντων", source: "Χαρακτηρισμοί Εσόδων / Κατηγορία" },
  { code: "category1_3", label: "Έσοδα από Παροχή Υπηρεσιών", source: "Χαρακτηρισμοί Εσόδων / Κατηγορία" },
  { code: "category1_4", label: "Έσοδα από Πώληση Παγίων", source: "Χαρακτηρισμοί Εσόδων / Κατηγορία" },
  { code: "category1_5", label: "Λοιπά Έσοδα/ Κέρδη", source: "Χαρακτηρισμοί Εσόδων / Κατηγορία" },
  { code: "category1_6", label: "Αυτοπαραδόσεις / Ιδιοχρησιμοποιήσεις", source: "Χαρακτηρισμοί Εσόδων / Κατηγορία" },
  { code: "category1_7", label: "Έσοδα για λ/σμο τρίτων", source: "Χαρακτηρισμοί Εσόδων / Κατηγορία" },
  { code: "category1_8", label: "Έσοδα προηγούμενων χρήσεων", source: "Χαρακτηρισμοί Εσόδων / Κατηγορία" },
  { code: "category1_9", label: "Έσοδα επομένων χρήσεων", source: "Χαρακτηρισμοί Εσόδων / Κατηγορία" },
  { code: "category1_10", label: "Λοιπές Εγγραφές Τακτοποίησης Εσόδων", source: "Χαρακτηρισμοί Εσόδων / Κατηγορία" },
  { code: "category1_95", label: "Λοιπά Πληροφοριακά Στοιχεία Εσόδων", source: "Χαρακτηρισμοί Εσόδων / Κατηγορία" },
  { code: "category3", label: "Διακίνηση", source: "Χαρακτηρισμοί Εσόδων / Κατηγορία" },
];

/** Income classification types (IncomeClassificationValueType, E3 codes). */
const INCOME_CLASSIFICATION_TYPES: SpecCatalogEntry[] = [
  { code: "E3_106", label: "Ιδιοπαραγωγή παγίων - Αυτοπαραδόσεις - Καταστροφές αποθεμάτων / Εμπορεύματα", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_205", label: "Ιδιοπαραγωγή παγίων - Αυτοπαραδόσεις - Καταστροφές αποθεμάτων / Πρώτες ύλες και λοιπά υλικά", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_210", label: "Ιδιοπαραγωγή παγίων - Αυτοπαραδόσεις - Καταστροφές αποθεμάτων / Προϊόντα και παραγωγή σε εξέλιξη", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_305", label: "Ιδιοπαραγωγή παγίων - Αυτοπαραδόσεις – Καταστροφές αποθεμάτων / Πρώτες ύλες και λοιπά υλικά", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_310", label: "Ιδιοπαραγωγή παγίων - Αυτοπαραδόσεις - Καταστροφές αποθεμάτων / Προϊόντα και παραγωγή σε εξέλιξη", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_318", label: "Ιδιοπαραγωγή παγίων - Αυτοπαραδόσεις - Καταστροφές αποθεμάτων / Έξοδα παραγωγής", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_561_001", label: "Πωλήσεις αγαθών και υπηρεσιών Χονδρικές - Επιτηδευματιών", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_561_002", label: "Πωλήσεις αγαθών και υπηρεσιών Χονδρικές βάσει άρθρου 39α παρ 5 Κώδικα ΦΠΑ", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_561_003", label: "Πωλήσεις αγαθών και υπηρεσιών Λιανικές - Ιδιωτική Πελατεία", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_561_004", label: "Πωλήσεις αγαθών και υπηρεσιών Λιανικές βάσει άρθρου 39α παρ 5 Κώδικα ΦΠΑ", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_561_005", label: "Πωλήσεις αγαθών και υπηρεσιών Εξωτερικού Ενδοκοινοτικές", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_561_006", label: "Πωλήσεις αγαθών και υπηρεσιών Εξωτερικού Τρίτες Χώρες", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_561_007", label: "Πωλήσεις αγαθών και υπηρεσιών Λοιπά", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_562", label: "Λοιπά συνήθη έσοδα", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_563", label: "Πιστωτικοί τόκοι και συναφή έσοδα", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_564", label: "Πιστωτικές συναλλαγματικές διαφορές", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_565", label: "Έσοδα συμμετοχών", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_566", label: "Κέρδη από διάθεση μη κυκλοφορούντων περιουσιακών στοιχείων", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_567", label: "Κέρδη από αναστροφή προβλέψεων και απομειώσεων", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_568", label: "Κέρδη από επιμέτρηση στην εύλογη αξία", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_570", label: "Ασυνήθη έσοδα και κέρδη", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_595", label: "Έξοδα σε ιδιοπαραγωγή", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_596", label: "Επιδοτήσεις - Επιχορηγήσεις", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_597", label: "Επιδοτήσεις - Επιχορηγήσεις για επενδυτικούς σκοπούς - κάλυψη δαπανών", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_880_001", label: "Πωλήσεις Παγίων Χονδρικές", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_880_002", label: "Πωλήσεις Παγίων Λιανικές", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_880_003", label: "Πωλήσεις Παγίων Εξωτερικού Ενδοκοινοτικές", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_880_004", label: "Πωλήσεις Παγίων Εξωτερικού Τρίτες Χώρες", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_881_001", label: "Πωλήσεις για λογ/σμο Τρίτων Χονδρικές", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_881_002", label: "Πωλήσεις για λογ/σμο Τρίτων Λιανικές", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_881_003", label: "Πωλήσεις για λογ/σμο Τρίτων Εξωτερικού Ενδοκοινοτικές", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_881_004", label: "Πωλήσεις για λογ/σμο Τρίτων Εξωτερικού Τρίτες Χώρες", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_598_001", label: "Πωλήσεις αγαθών που υπάγονται σε ΕΦΚ", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
  { code: "E3_598_003", label: "Πωλήσεις για λογαριασμό αγροτών μέσω αγροτικού συνεταιρισμού κλπ", source: "Χαρακτηρισμοί Εσόδων / Τύπος" },
];

/** Withholding tax categories (WithheldType 1..18). */
const WITHHOLDING_CATEGORIES: SpecCatalogEntry[] = [
  { code: "1", label: "Περιπτ. β’ - Τόκοι - 15%", source: "Κατηγορίες Παρακρατούμενων Φόρων" },
  { code: "2", label: "Περιπτ. γ’ - Δικαιώματα - 20%", source: "Κατηγορίες Παρακρατούμενων Φόρων" },
  { code: "3", label: "Περιπτ. δ’ - Αμοιβές Συμβουλών Διοίκησης - 20%", source: "Κατηγορίες Παρακρατούμενων Φόρων" },
  { code: "4", label: "Περιπτ. δ’ - Τεχνικά Έργα - 3%", source: "Κατηγορίες Παρακρατούμενων Φόρων" },
  { code: "5", label: "Υγρά καύσιμα και προϊόντα καπνοβιομηχανίας 1%", source: "Κατηγορίες Παρακρατούμενων Φόρων" },
  { code: "6", label: "Λοιπά Αγαθά 4%", source: "Κατηγορίες Παρακρατούμενων Φόρων" },
  { code: "7", label: "Παροχή Υπηρεσιών 8%", source: "Κατηγορίες Παρακρατούμενων Φόρων" },
  { code: "8", label: "Προκαταβλητέος Φόρος Αρχιτεκτόνων/Μηχανικών επί Μελετών και Σχεδίων 4%", source: "Κατηγορίες Παρακρατούμενων Φόρων" },
  { code: "9", label: "Προκαταβλητέος Φόρος Αρχιτεκτόνων/Μηχανικών λοιπά έργα 10%", source: "Κατηγορίες Παρακρατούμενων Φόρων" },
  { code: "10", label: "Προκαταβλητέος Φόρος στις Αμοιβές Δικηγόρων 15%", source: "Κατηγορίες Παρακρατούμενων Φόρων" },
  { code: "11", label: "Παρακράτηση Φόρου Μισθωτών Υπηρεσιών παρ. 1 αρ. 15 ν. 4172/2013", source: "Κατηγορίες Παρακρατούμενων Φόρων" },
  { code: "12", label: "Παρακράτηση Φόρου Μισθωτών - Αξιωματικών Εμπορικού Ναυτικού 15%", source: "Κατηγορίες Παρακρατούμενων Φόρων" },
  { code: "13", label: "Παρακράτηση Φόρου Μισθωτών - Κατώτερο Πλήρωμα Εμπορικού Ναυτικού 10%", source: "Κατηγορίες Παρακρατούμενων Φόρων" },
  { code: "14", label: "Παρακράτηση Ειδικής Εισφοράς Αλληλεγγύης", source: "Κατηγορίες Παρακρατούμενων Φόρων" },
  { code: "15", label: "Παρακράτηση Φόρου Αποζημίωσης λόγω Διακοπής Σχέσης Εργασίας", source: "Κατηγορίες Παρακρατούμενων Φόρων" },
  { code: "16", label: "Παρακρατήσεις συναλλαγών αλλοδαπής βάσει Σ.Α.Δ.Φ.", source: "Κατηγορίες Παρακρατούμενων Φόρων" },
  { code: "17", label: "Λοιπές Παρακρατήσεις Φόρου", source: "Κατηγορίες Παρακρατούμενων Φόρων" },
  { code: "18", label: "Παρακράτηση Φόρου Μερίσματα περ.α παρ. 1 αρ. 64 ν. 4172/2013 5%", source: "Κατηγορίες Παρακρατούμενων Φόρων" },
];

export const SPEC: SpecStatus = {
  version: "2.0.2",
  // Canonical location on aade.gr (unreachable from the build environment; see PROVENANCE.md).
  documentUrl: "https://www.aade.gr/epicheiriseis/mydata-ilektronika-biblia-aade/mydata/texniki-perigrafi-diepafon-mydata-rest-api",
  retrievedAt: "2026-10-21",
  // Unlocked on 2026-10-28: an accountant confirmed the tax rules and the real
  // myDATA sandbox accepted a document built from this catalog (SendInvoices +
  // CancelInvoice round-trip). Issuance stays limited to the test environment and
  // to consumer documents by the `environment` and `channel` checks.
  verified: true,
  provenance: "XSDs and labels from the firebed/aade-mydata v2.0.2 mirror (aade.gr unreachable from the build env), validated end to end against the myDATA sandbox on 2026-10-28.",
  documentTypes: DOCUMENT_TYPES,
  vatCategories: VAT_CATEGORIES,
  vatExemptionCategories: VAT_EXEMPTION_CATEGORIES,
  incomeClassificationCategories: INCOME_CLASSIFICATION_CATEGORIES,
  incomeClassificationTypes: INCOME_CLASSIFICATION_TYPES,
  withholdingCategories: WITHHOLDING_CATEGORIES,
};

export function specReady(spec: SpecStatus = SPEC): boolean {
  return spec.verified && spec.version !== null && spec.documentTypes.length > 0 && spec.vatCategories.length > 0;
}

/** True when a code entered in a profile exists in the loaded catalog. */
export function inCatalog(list: SpecCatalogEntry[], code: string): boolean {
  return list.some((e) => e.code === code);
}
