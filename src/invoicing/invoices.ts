import { DateTime } from "luxon";
import type { Db } from "../db/db";
import type { AppContext } from "../server/context";
import type { ResolvedFields } from "../intent-parsing/resolve";
import { ZONE } from "../intent-parsing/greekDate";
import { isValidAfm } from "../shared/afm";
import { nameStems, type Client } from "../clients/clients";
import { calculate, consistencyProblems, CalcError, type CalcLineInput, type CalcResult, type PriceBasis } from "./calc";
import { profileIssues, type BusinessProfile } from "./profile";
import { SPEC, specReady, type SpecStatus } from "../aade/spec";
import { loadCredentials } from "../aade/credentials";

export type Counterpart = "business" | "consumer";
export type InvoiceStatus = "draft" | "sending" | "issued" | "rejected" | "unknown" | "cancelled";

export interface DraftLine extends CalcLineInput {
  vat_category_id: string;
  vat_category_label: string;
  vat_aade_code: string;
  exemption_code: string;
}

/** Snapshot stored with a draft. Issuance re-validates it against the current profile. */
export interface InvoiceDraft {
  customer: { client_id: string | null; name: string; vat_number: string | null; counterpart: Counterpart };
  document_type: BusinessProfile["document_types"][number];
  price_basis: PriceBasis;
  lines: DraftLine[];
  withholdings: Array<BusinessProfile["withholdings"][number]>;
  calc: CalcResult;
}

export interface InvoicePlan {
  counterpart: Counterpart | null;
  documentTypeChoice: { options: Array<{ id: string; label: string }>; selected: string | null };
  lines: Array<{ vat_category_id: string; vat_category_label: string; options: Array<{ id: string; label: string }>; source: "choice" | "catalog" | "default" }>;
  calc: CalcResult | null;
  profileIssues: string[];
  draft: InvoiceDraft | null;
}

export interface InvoicePlanChoices {
  documentTypeId?: string;
  lineVatCategoryIds?: string[];
}

/**
 * Turns a resolved invoice card into a concrete draft using the business
 * profile: document type, VAT category per line, withholdings and totals.
 * Nothing here is decided by the LLM.
 */
export function planInvoice(
  f: Extract<ResolvedFields, { type: "create_invoice" }>,
  profile: BusinessProfile,
  customer: { client: Client | null; newName: string | null },
  choices: InvoicePlanChoices,
  blockers: string[],
  warnings: string[],
): InvoicePlan {
  const issues = profileIssues(profile).map((i) => i.message);
  const counterpart: Counterpart | null = customer.client ? (customer.client.vat_number ? "business" : "consumer") : customer.newName ? "consumer" : null;

  const types = profile.document_types.filter((d) => counterpart === null || d.counterpart === counterpart);
  const docOptions = types.map((d) => ({ id: d.id, label: `${d.label} (σειρά ${d.series})` }));
  const docSelected =
    choices.documentTypeId && types.some((d) => d.id === choices.documentTypeId)
      ? choices.documentTypeId
      : types.length === 1
        ? types[0]!.id
        : null;
  if (counterpart && types.length === 0) {
    blockers.push(
      counterpart === "business"
        ? "Το προφίλ δεν έχει τύπο παραστατικού για επιχειρήσεις."
        : "Το προφίλ δεν έχει τύπο παραστατικού για ιδιώτες.",
    );
  } else if (types.length > 1 && !docSelected) {
    blockers.push("Διάλεξε τύπο παραστατικού.");
  }

  const vatOptions = profile.vat_categories.map((c) => ({ id: c.id, label: `${c.label} (${c.rate}%)` }));
  const lines = f.lines.map((l, i) => {
    const chosen = choices.lineVatCategoryIds?.[i];
    const byChoice = chosen ? profile.vat_categories.find((c) => c.id === chosen) : undefined;
    const item = l.description ? matchCatalog(l.description, profile) : undefined;
    const byCatalog = item ? profile.vat_categories.find((c) => c.id === item.vat_category_id) : undefined;
    const byDefault = profile.vat_categories.find((c) => c.id === profile.default_vat_category_id);
    const cat = byChoice ?? byCatalog ?? byDefault;
    const source = byChoice ? "choice" : byCatalog ? "catalog" : "default";
    if (cat && source !== "choice") {
      warnings.push(
        `Γραμμή ${i + 1}: ΦΠΑ «${cat.label}» ${source === "catalog" ? `από τον κατάλογο («${item!.name}»)` : "(προεπιλογή του προφίλ)"}.`,
      );
    }
    return { vat_category_id: cat?.id ?? "", vat_category_label: cat ? `${cat.label} (${cat.rate}%)` : "", options: vatOptions, source } as const;
  });
  if (profile.vat_categories.length === 0) blockers.push("Το προφίλ δεν έχει κατηγορίες ΦΠΑ. Συμπλήρωσέ το από τις Ρυθμίσεις.");
  if (issues.length > 0) warnings.push(`Το προφίλ επιχείρησης είναι ελλιπές (${issues.length} στοιχεία). Το προσχέδιο αποθηκεύεται, αλλά η έκδοση θα μπλοκάρει.`);

  const withholdings = profile.withholdings.filter((w) => w.applies_to === "all" || (w.applies_to === "business_customers" && counterpart === "business"));

  let calc: CalcResult | null = null;
  let draft: InvoiceDraft | null = null;
  const docType = profile.document_types.find((d) => d.id === docSelected);
  const draftLines: DraftLine[] | null = f.lines.every((l, i) => l.description && l.quantity && l.amount && l.amount_scope && lines[i]!.vat_category_id)
    ? f.lines.map((l, i) => {
        const cat = profile.vat_categories.find((c) => c.id === lines[i]!.vat_category_id)!;
        return {
          description: l.description!,
          quantity: l.quantity!,
          amount: l.amount!,
          amount_scope: l.amount_scope!,
          vat_rate: cat.rate,
          vat_category_id: cat.id,
          vat_category_label: cat.label,
          vat_aade_code: cat.aade_code,
          exemption_code: cat.exemption_code,
        };
      })
    : null;
  if (draftLines && f.price_basis) {
    try {
      calc = calculate(draftLines, f.price_basis, withholdings);
    } catch (e) {
      if (!(e instanceof CalcError)) throw e;
      blockers.push("Τα ποσά δεν μπορούν να υπολογιστούν. Έλεγξε ποσότητες και τιμές.");
    }
  }
  if (calc && docType && counterpart && draftLines && f.price_basis) {
    draft = {
      customer: {
        client_id: customer.client?.id ?? null,
        name: customer.client?.name ?? customer.newName ?? "",
        vat_number: customer.client?.vat_number ?? null,
        counterpart,
      },
      document_type: docType,
      price_basis: f.price_basis,
      lines: draftLines,
      withholdings,
      calc,
    };
  }
  return { counterpart, documentTypeChoice: { options: docOptions, selected: docSelected }, lines, calc, profileIssues: issues, draft };
}

function matchCatalog(description: string, profile: BusinessProfile) {
  const want = nameStems(description);
  return profile.catalog.find((item) => {
    const stems = nameStems(item.name);
    return stems.length > 0 && stems.every((s) => want.includes(s));
  });
}

// --- persistence -----------------------------------------------------------------

export interface InvoiceRow {
  id: string;
  client_id: string | null;
  status: InvoiceStatus;
  environment: "test" | "prod";
  document_type_id: string;
  series: string | null;
  number: number | null;
  issue_date: string | null;
  idempotency_key: string;
  draft: InvoiceDraft;
  request_xml: string | null;
  mark: string | null;
  uid: string | null;
  aade_error: unknown;
  created_at: string;
  issued_at: string | null;
}

const COLUMNS =
  "id, client_id, status, environment, document_type_id, series, number, issue_date, idempotency_key, draft, request_xml, mark, uid, aade_error, created_at, issued_at";

function toRow(r: Record<string, unknown>): InvoiceRow {
  return {
    ...(r as unknown as InvoiceRow),
    draft: (typeof r.draft === "string" ? JSON.parse(r.draft) : r.draft) as InvoiceDraft,
    issue_date: r.issue_date ? DateTime.fromJSDate(new Date(r.issue_date as string)).toISODate() : null,
    created_at: new Date(r.created_at as string).toISOString(),
    issued_at: r.issued_at ? new Date(r.issued_at as string).toISOString() : null,
  };
}

export async function insertDraft(db: Db, userId: string, draft: InvoiceDraft): Promise<InvoiceRow> {
  const [row] = await db.query<Record<string, unknown>>(
    `insert into invoices (user_id, client_id, document_type_id, series, draft)
     values ($1, $2, $3, $4, $5) returning ${COLUMNS}`,
    [userId, draft.customer.client_id, draft.document_type.id, draft.document_type.series, JSON.stringify(draft)],
  );
  return toRow(row!);
}

export interface InvoiceListOptions {
  /** Free text matched against client name, series, number or MARK. */
  search?: string;
  status?: InvoiceStatus;
  limit?: number;
  offset?: number;
}

export interface InvoiceListResult {
  invoices: InvoiceRow[];
  hasMore: boolean;
}

/** A page of the user's invoices, newest first, with optional search and status filters. */
export async function listInvoices(db: Db, userId: string, opts: InvoiceListOptions = {}): Promise<InvoiceListResult> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50) || 50, 1), 200);
  const offset = Math.max(Math.trunc(opts.offset ?? 0) || 0, 0);
  const where = ["user_id = $1"];
  const params: unknown[] = [userId];
  if (opts.status) {
    params.push(opts.status);
    where.push(`status = $${params.length}`);
  }
  const term = opts.search?.trim();
  if (term) {
    params.push(`%${term}%`);
    const p = `$${params.length}`;
    where.push(
      `(draft->'customer'->>'name' ilike ${p} or draft->'customer'->>'vat_number' ilike ${p} ` +
        `or draft->'calc'->'totals'->>'gross' ilike ${p} or draft->'calc'->'totals'->>'payable' ilike ${p} ` +
        `or series ilike ${p} or coalesce(mark, '') ilike ${p} or coalesce(number::text, '') ilike ${p})`,
    );
  }
  params.push(limit + 1, offset);
  // Fetch one extra row to tell whether another page exists.
  const rows = await db.query<Record<string, unknown>>(
    `select ${COLUMNS} from invoices where ${where.join(" and ")} order by created_at desc limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return { invoices: rows.slice(0, limit).map(toRow), hasMore: rows.length > limit };
}

export async function getInvoice(db: Db, userId: string, id: string): Promise<InvoiceRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.query<Record<string, unknown>>(`select ${COLUMNS} from invoices where user_id = $1 and id = $2`, [userId, id]);
  return row ? toRow(row) : null;
}

export async function deleteDraft(db: Db, userId: string, id: string): Promise<boolean> {
  const rows = await db.query("delete from invoices where user_id = $1 and id = $2 and status = 'draft' returning id", [userId, id]);
  return rows.length > 0;
}

/**
 * Next number in a series: one after the highest number that reached (or may
 * have reached) AADE. Rejected documents do not hold a number, so a rejected
 * number is reused (README Φ4); at most one document per series may be in
 * flight, so a rejection is always the latest number.
 */
export async function nextNumber(db: Db, userId: string, env: string, docTypeId: string, series: string): Promise<number> {
  const [row] = await db.query<{ max: number | null }>(
    `select max(number) as max from invoices
     where user_id = $1 and environment = $2 and document_type_id = $3 and series = $4
       and status in ('sending', 'issued', 'unknown', 'cancelled')`,
    [userId, env, docTypeId, series],
  );
  return (row?.max ?? 0) + 1;
}

/** JSON with sorted keys: jsonb does not preserve key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

// --- mandatory checks --------------------------------------------------------------

export interface CheckResult {
  code: string;
  ok: boolean;
  message: string;
}

export interface IssueOptions {
  environment: "test" | "prod";
  /** ISO date; defaults to today in Athens. */
  issueDate?: string;
  /** Provider configured for B2B documents (README Φ1). None exists yet. */
  b2bProviderConfigured?: boolean;
  spec?: SpecStatus;
}

/**
 * Every check that must pass before a document may be sent. All checks run so
 * the user sees the full list; issuance requires every one to be ok.
 */
export async function issueChecks(
  ctx: AppContext,
  userId: string,
  invoice: InvoiceRow,
  profile: BusinessProfile,
  opts: IssueOptions,
): Promise<CheckResult[]> {
  const spec = opts.spec ?? SPEC;
  const d = invoice.draft;
  const checks: CheckResult[] = [];
  const check = (code: string, ok: boolean, okMessage: string, failMessage: string) =>
    checks.push({ code, ok, message: ok ? okMessage : failMessage });

  check(
    "spec_verified",
    specReady(spec),
    `Προδιαγραφή myDATA ${spec.version} επαληθευμένη.`,
    "Η επίσημη προδιαγραφή myDATA δεν έχει φορτωθεί και επαληθευτεί ακόμη. Η έκδοση είναι κλειδωμένη.",
  );

  const issues = profileIssues(profile, spec);
  check("profile_complete", issues.length === 0, "Το προφίλ επιχείρησης είναι πλήρες.", `Ελλιπές προφίλ: ${issues.map((i) => i.message).join(" ")}`);

  check("issuer_afm", isValidAfm(profile.afm), "Έγκυρος ΑΦΜ εκδότη.", "Ο ΑΦΜ του εκδότη λείπει ή δεν είναι έγκυρος.");

  // The customer is re-read: the client record may have changed since the draft.
  const client = d.customer.client_id
    ? (await ctx.db.query<{ name: string; vat_number: string | null }>("select name, vat_number from clients where user_id = $1 and id = $2", [userId, d.customer.client_id]))[0]
    : undefined;
  const customerAfm = client?.vat_number ?? d.customer.vat_number;
  if (d.customer.counterpart === "business") {
    check(
      "customer_afm",
      !!customerAfm && isValidAfm(customerAfm) && customerAfm !== profile.afm,
      "Έγκυρος ΑΦΜ πελάτη.",
      "Για παραστατικό προς επιχείρηση απαιτείται έγκυρος ΑΦΜ πελάτη (διαφορετικός από του εκδότη).",
    );
  } else {
    check("customer_afm", !customerAfm || isValidAfm(customerAfm), "Πελάτης ιδιώτης.", "Ο ΑΦΜ του πελάτη δεν είναι έγκυρος.");
  }

  const docType = profile.document_types.find((t) => t.id === d.document_type.id);
  const currentCounterpart: Counterpart = customerAfm ? "business" : "consumer";
  check(
    "document_type_compatible",
    !!docType && docType.aade_code === d.document_type.aade_code && docType.counterpart === d.customer.counterpart && currentCounterpart === d.customer.counterpart,
    "Ο τύπος παραστατικού επιτρέπεται από το προφίλ και ταιριάζει στον πελάτη.",
    !docType || docType.aade_code !== d.document_type.aade_code
      ? "Ο τύπος παραστατικού δεν υπάρχει πλέον (ή άλλαξε) στο προφίλ."
      : "Ο τύπος παραστατικού δεν ταιριάζει στον πελάτη (επιχείρηση/ιδιώτης).",
  );

  const missing: string[] = [];
  if (!d.customer.name) missing.push("όνομα πελάτη");
  if (!d.document_type.aade_code) missing.push("κωδικός τύπου παραστατικού");
  if (!d.document_type.series) missing.push("σειρά");
  if (!d.document_type.income_classification_category || !d.document_type.income_classification_type) missing.push("χαρακτηρισμός εσόδων");
  d.lines.forEach((l, i) => {
    if (!l.description.trim()) missing.push(`περιγραφή γραμμής ${i + 1}`);
    if (!l.vat_aade_code) missing.push(`κωδικός ΦΠΑ γραμμής ${i + 1}`);
    if (Number(l.vat_rate) === 0 && !l.exemption_code) missing.push(`κωδικός απαλλαγής γραμμής ${i + 1}`);
  });
  d.withholdings.forEach((w) => {
    if (!w.aade_code) missing.push(`κωδικός κράτησης «${w.label}»`);
  });
  // TODO(spec): add every field the official specification marks as mandatory for the document type.
  check("required_fields", missing.length === 0, "Όλα τα γνωστά υποχρεωτικά πεδία υπάρχουν.", `Λείπουν: ${missing.join(", ")}.`);

  let recomputed: CalcResult | null = null;
  try {
    recomputed = calculate(d.lines, d.price_basis, d.withholdings);
  } catch {
    recomputed = null;
  }
  const consistency = consistencyProblems(d.calc);
  const same = recomputed !== null && canonical(recomputed) === canonical(d.calc);
  check(
    "totals_consistent",
    consistency.length === 0 && same,
    "Καθαρή αξία + ΦΠΑ = σύνολο, ανά γραμμή και συνολικά.",
    [...consistency, ...(same ? [] : ["Τα αποθηκευμένα ποσά δεν συμφωνούν με νέο υπολογισμό."])].join(" "),
  );

  const todayCtx = DateTime.fromJSDate(ctx.now()).setZone(ZONE).toISODate()!;
  const issueDate = opts.issueDate ?? todayCtx;
  // Accountant-confirmed (2026-10-28): myDATA is real time, so only today's date is allowed.
  check(
    "issue_date",
    /^\d{4}-\d{2}-\d{2}$/.test(issueDate) && DateTime.fromISO(issueDate).isValid && issueDate === todayCtx,
    `Ημερομηνία έκδοσης ${issueDate}.`,
    `Η ημερομηνία έκδοσης ${issueDate} δεν επιτρέπεται: προς το παρόν μόνο η σημερινή (${todayCtx}).`,
  );

  const series = d.document_type.series;
  const inFlight = await ctx.db.query(
    `select 1 from invoices where user_id = $1 and environment = $2 and document_type_id = $3 and series = $4
       and status in ('sending', 'unknown') and id <> $5`,
    [userId, opts.environment, d.document_type.id, series, invoice.id],
  );
  check(
    "numbering",
    !!series && inFlight.length === 0,
    `Σειρά ${series}, επόμενος αριθμός ${await nextNumber(ctx.db, userId, opts.environment, d.document_type.id, series)}.`,
    !series
      ? "Δεν έχει οριστεί σειρά αρίθμησης."
      : "Υπάρχει παραστατικό της ίδιας σειράς σε εκκρεμότητα (αποστολή ή άγνωστη κατάσταση). Πρέπει πρώτα να διευκρινιστεί.",
  );

  check(
    "not_already_sent",
    invoice.status === "draft" && !!invoice.idempotency_key,
    "Δεν έχει σταλεί ξανά (μοναδικό κλειδί αποστολής).",
    `Το παραστατικό είναι σε κατάσταση «${invoice.status}» και δεν μπορεί να σταλεί ξανά.`,
  );

  check(
    "environment",
    opts.environment === "test",
    "Δοκιμαστικό περιβάλλον ΑΑΔΕ.",
    "Το πραγματικό περιβάλλον ενεργοποιείται στη φάση (δ).",
  );

  const creds = await loadCredentials(ctx, userId, opts.environment).catch(() => null);
  check(
    "credentials",
    !!creds,
    "Υπάρχουν διαπιστευτήρια myDATA.",
    `Δεν έχουν οριστεί διαπιστευτήρια myDATA για το ${opts.environment === "test" ? "δοκιμαστικό" : "πραγματικό"} περιβάλλον.`,
  );

  check(
    "channel",
    d.customer.counterpart === "consumer" || !!opts.b2bProviderConfigured,
    d.customer.counterpart === "consumer" ? "Αποστολή απευθείας στο myDATA." : "Αποστολή μέσω παρόχου ηλεκτρονικής τιμολόγησης.",
    "Τα παραστατικά προς επιχειρήσεις εκδίδονται μέσω πιστοποιημένου παρόχου ηλεκτρονικής τιμολόγησης, που δεν έχει οριστεί ακόμη.",
  );

  return checks;
}
