import { z } from "zod";
import type { Db } from "../db/db";
import { isValidAfm } from "../shared/afm";
import { SPEC, inCatalog, specReady, type SpecStatus } from "../aade/spec";

const decimal = z.string().regex(/^\d+(\.\d+)?$/, "μη έγκυρος αριθμός");
const id = z.string().min(1).max(40);
const text = (max: number) => z.string().trim().max(max);
const code = z.string().trim().max(20);

/**
 * Business profile, filled in by the user or their accountant. The system
 * never infers tax treatment from the profession: everything tax-related
 * comes from here, and AADE codes are entered as given by the accountant and
 * cross-checked against the official catalog once it is loaded.
 */
export const BusinessProfile = z.object({
  afm: text(12).default(""),
  legal_name: text(200).default(""),
  trade_name: text(200).default(""),
  doy: text(100).default(""),
  address: z
    .object({
      street: text(120).default(""),
      number: text(20).default(""),
      postal_code: text(10).default(""),
      city: text(80).default(""),
    })
    .default({}),
  activity: text(300).default(""),
  /** Branch/establishment number as registered with AADE ("0" for headquarters). TODO(spec): confirm field semantics. */
  branch: z.string().regex(/^\d{1,6}$/).default("0"),
  vat_regime: z.enum(["normal", "exempt", ""]).default(""),
  vat_categories: z
    .array(
      z.object({
        id,
        label: text(80),
        rate: decimal,
        aade_code: code,
        /** Required by the accountant for 0% categories (exemption reason code). */
        exemption_code: code.default(""),
      }),
    )
    .max(20)
    .default([]),
  default_vat_category_id: z.string().max(40).default(""),
  document_types: z
    .array(
      z.object({
        id,
        label: text(80),
        aade_code: code,
        counterpart: z.enum(["business", "consumer"]),
        series: text(20),
        income_classification_category: code,
        income_classification_type: code,
      }),
    )
    .max(20)
    .default([]),
  withholdings: z
    .array(
      z.object({
        id,
        label: text(80),
        rate: decimal,
        aade_code: code,
        applies_to: z.enum(["business_customers", "all"]),
      }),
    )
    .max(10)
    .default([]),
  catalog: z
    .array(
      z.object({
        id,
        name: text(120),
        unit_price: decimal.or(z.literal("")).default(""),
        price_basis: z.enum(["with_vat", "without_vat"]),
        vat_category_id: z.string().max(40),
      }),
    )
    .max(500)
    .default([]),
  /** The accountant (or the user, under their responsibility) confirmed the tax settings. */
  reviewed_by_accountant: z.boolean().default(false),
});
export type BusinessProfile = z.infer<typeof BusinessProfile>;

export const EMPTY_PROFILE: BusinessProfile = BusinessProfile.parse({});

export interface ProfileIssue {
  field: string;
  message: string;
}

/** Everything that must be filled in before any document can be issued. */
export function profileIssues(p: BusinessProfile, spec: SpecStatus = SPEC): ProfileIssue[] {
  const issues: ProfileIssue[] = [];
  const need = (ok: boolean, field: string, message: string) => {
    if (!ok) issues.push({ field, message });
  };
  need(isValidAfm(p.afm), "afm", "Έγκυρος ΑΦΜ επιχείρησης.");
  need(p.legal_name.length > 0, "legal_name", "Επωνυμία ή ονοματεπώνυμο.");
  need(p.doy.length > 0, "doy", "ΔΟΥ.");
  need(
    p.address.street.length > 0 && p.address.postal_code.length > 0 && p.address.city.length > 0,
    "address",
    "Διεύθυνση (οδός, ΤΚ, πόλη).",
  );
  need(p.activity.length > 0, "activity", "Δραστηριότητα.");
  need(p.vat_regime !== "", "vat_regime", "Καθεστώς ΦΠΑ.");
  need(p.vat_categories.length > 0, "vat_categories", "Τουλάχιστον μία κατηγορία ΦΠΑ.");
  p.vat_categories.forEach((c, i) => {
    need(c.label.length > 0 && c.aade_code.length > 0, `vat_categories.${i}`, `Κατηγορία ΦΠΑ ${i + 1}: όνομα και κωδικός ΑΑΔΕ.`);
    need(Number(c.rate) > 0 || c.exemption_code.length > 0, `vat_categories.${i}.exemption_code`, `Κατηγορία ΦΠΑ «${c.label}»: για 0% απαιτείται κωδικός απαλλαγής.`);
  });
  need(
    p.vat_categories.some((c) => c.id === p.default_vat_category_id),
    "default_vat_category_id",
    "Προεπιλεγμένη κατηγορία ΦΠΑ.",
  );
  if (p.vat_regime === "exempt") {
    need(p.vat_categories.every((c) => Number(c.rate) === 0), "vat_categories", "Σε καθεστώς απαλλαγής όλες οι κατηγορίες ΦΠΑ πρέπει να είναι 0%.");
  }
  need(p.document_types.length > 0, "document_types", "Τουλάχιστον ένας επιτρεπόμενος τύπος παραστατικού.");
  p.document_types.forEach((d, i) => {
    need(
      d.label.length > 0 && d.aade_code.length > 0 && d.series.length > 0,
      `document_types.${i}`,
      `Τύπος παραστατικού ${i + 1}: όνομα, κωδικός ΑΑΔΕ και σειρά.`,
    );
    need(
      d.income_classification_category.length > 0 && d.income_classification_type.length > 0,
      `document_types.${i}.classification`,
      `Τύπος «${d.label}»: χαρακτηρισμός εσόδων (κατηγορία και τύπος).`,
    );
  });
  const seriesKeys = p.document_types.map((d) => `${d.id}`);
  need(new Set(seriesKeys).size === seriesKeys.length, "document_types", "Διπλότυπα αναγνωριστικά τύπων παραστατικών.");
  p.withholdings.forEach((w, i) => {
    need(w.label.length > 0 && w.aade_code.length > 0, `withholdings.${i}`, `Κράτηση ${i + 1}: όνομα και κωδικός ΑΑΔΕ.`);
  });
  need(p.reviewed_by_accountant, "reviewed_by_accountant", "Επιβεβαίωση ότι τα φορολογικά στοιχεία ελέγχθηκαν από λογιστή.");

  // Codes are cross-checked against the official catalog once it is loaded.
  if (specReady(spec)) {
    p.document_types.forEach((d, i) =>
      need(inCatalog(spec.documentTypes, d.aade_code), `document_types.${i}.aade_code`, `Ο κωδικός τύπου «${d.aade_code}» δεν υπάρχει στην προδιαγραφή ${spec.version}.`),
    );
    p.vat_categories.forEach((c, i) =>
      need(inCatalog(spec.vatCategories, c.aade_code), `vat_categories.${i}.aade_code`, `Ο κωδικός ΦΠΑ «${c.aade_code}» δεν υπάρχει στην προδιαγραφή ${spec.version}.`),
    );
  }
  return issues;
}

export async function loadProfile(db: Db, userId: string): Promise<BusinessProfile> {
  const [row] = await db.query<{ data: unknown }>("select data from business_profiles where user_id = $1", [userId]);
  if (!row) return EMPTY_PROFILE;
  const parsed = BusinessProfile.safeParse(typeof row.data === "string" ? JSON.parse(row.data) : row.data);
  return parsed.success ? parsed.data : EMPTY_PROFILE;
}

export async function saveProfile(db: Db, userId: string, profile: BusinessProfile): Promise<void> {
  await db.query(
    `insert into business_profiles (user_id, data, updated_at) values ($1, $2, now())
     on conflict (user_id) do update set data = excluded.data, updated_at = now()`,
    [userId, JSON.stringify(profile)],
  );
}
