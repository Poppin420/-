import { DateTime } from "luxon";
import type { RawAction, ActionType } from "./schema";
import { containsSpan, normalizeGreek, tokenize } from "./greekText";
import { numberWordValue, parseGreekDecimal } from "./greekNumbers";
import { parseMoney } from "./greekMoney";
import { parseGreekTime } from "./greekTime";
import { parseGreekDate, parseGreekDuration, weekdayName, ZONE, type DateMode } from "./greekDate";
import { isValidAfm } from "../shared/afm";

export const DEFAULT_APPOINTMENT_MINUTES = 60;

export interface QuestionOption {
  label: string;
  value: string;
}

export interface Question {
  field: string;
  message: string;
  options?: QuestionOption[];
}

export interface Assumption {
  field: string;
  message: string;
}

export type PriceBasis = "with_vat" | "without_vat";
export type AmountScope = "unit" | "total";

export interface ResolvedInvoiceLine {
  description: string | null;
  quantity: string | null;
  amount: string | null;
  amount_scope: AmountScope | null;
}

export type ResolvedFields =
  | {
      type: "create_appointment";
      client_name: string | null;
      date: string | null;
      time: string | null;
      start: string | null;
      duration_minutes: number | null;
      title: string | null;
    }
  | {
      type: "reschedule_appointment";
      client_name: string | null;
      original_date: string | null;
      original_time: string | null;
      new_date: string | null;
      new_time: string | null;
      new_start: string | null;
    }
  | { type: "cancel_appointment"; client_name: string | null; date: string | null; time: string | null }
  | { type: "query_calendar"; start: string | null; end: string | null }
  | {
      type: "create_invoice";
      client_name: string | null;
      lines: ResolvedInvoiceLine[];
      price_basis: PriceBasis | null;
    }
  | {
      type: "create_client";
      client_name: string | null;
      vat_number: string | null;
      phone: string | null;
      email: string | null;
    };

/** One confirmation card per action. Nothing here has side effects. */
export interface ActionCard {
  id: string;
  type: ActionType;
  raw: RawAction;
  /** Field paths whose value came from the user's answer rather than the transcript. */
  userProvided: string[];
  fields: ResolvedFields;
  questions: Question[];
  assumptions: Assumption[];
  ready: boolean;
}

interface Ctx {
  raw: RawAction;
  transcript: string;
  today: DateTime;
  userProvided: Set<string>;
  questions: Question[];
  assumptions: Assumption[];
}

export function resolveAction(
  raw: RawAction,
  transcript: string,
  now: Date,
  userProvided: string[] = [],
  id: string = globalThis.crypto.randomUUID(),
): ActionCard {
  const ctx: Ctx = {
    raw,
    transcript,
    today: DateTime.fromJSDate(now, { zone: ZONE }).startOf("day"),
    userProvided: new Set(userProvided),
    questions: [],
    assumptions: [],
  };
  const fields = resolveFields(ctx);
  return {
    id,
    type: raw.type,
    raw,
    userProvided: [...ctx.userProvided],
    fields,
    questions: ctx.questions,
    assumptions: ctx.assumptions,
    ready: ctx.questions.length === 0,
  };
}

/**
 * Applies the user's answer to one field and re-resolves the card. The answer
 * is free text (typed or picked from options) and goes through the same
 * deterministic parsers as the transcript.
 */
export function answerQuestion(card: ActionCard, field: string, value: string, transcript: string, now: Date): ActionCard {
  const raw = structuredClone(card.raw) as Record<string, unknown>;
  setPath(raw, field, value.trim() === "" ? null : value.trim());
  const provided = new Set(card.userProvided);
  provided.add(field);
  return resolveAction(raw as RawAction, transcript, now, [...provided], card.id);
}

function resolveFields(ctx: Ctx): ResolvedFields {
  const raw = ctx.raw;
  switch (raw.type) {
    case "create_appointment": {
      const client_name = requireName(ctx, "client_name", "Με ποιον είναι το ραντεβού;");
      const date = resolveDate(ctx, "date_text", "future", "Ποια μέρα είναι το ραντεβού;");
      const time = resolveTime(ctx, "time_text", "Τι ώρα είναι το ραντεβού;");
      const duration_minutes = resolveDuration(ctx, "duration_text");
      const start = date && time ? combine(ctx, "time_text", date, time) : null;
      return { type: raw.type, client_name, date, time, start, duration_minutes, title: span(ctx, "title") };
    }
    case "reschedule_appointment": {
      const client_name = span(ctx, "client_name");
      const original_date = optionalDate(ctx, "original_date_text", "any");
      const original_time = optionalTime(ctx, "original_time_text");
      if (!client_name && !original_date) {
        ask(ctx, "client_name", "Ποιο ραντεβού να μετακινήσω; Πες μου το όνομα του πελάτη.");
      }
      const new_date = resolveDate(ctx, "new_date_text", "future", "Για ποια μέρα να το μετακινήσω;");
      const new_time = resolveTime(ctx, "new_time_text", "Για τι ώρα να το μετακινήσω;");
      const new_start = new_date && new_time ? combine(ctx, "new_time_text", new_date, new_time) : null;
      return { type: raw.type, client_name, original_date, original_time, new_date, new_time, new_start };
    }
    case "cancel_appointment": {
      const client_name = span(ctx, "client_name");
      const date = optionalDate(ctx, "date_text", "any");
      const time = optionalTime(ctx, "time_text");
      if (!client_name && !date) ask(ctx, "client_name", "Ποιο ραντεβού να ακυρώσω; Πες μου το όνομα του πελάτη.");
      return { type: raw.type, client_name, date, time };
    }
    case "query_calendar": {
      const value = span(ctx, "date_text");
      if (!value) {
        ask(ctx, "date_text", "Για ποια μέρα ή εβδομάδα θέλεις το πρόγραμμα;");
        return { type: raw.type, start: null, end: null };
      }
      const parsed = parseGreekDate(value, ctx.today, "any");
      if (parsed.kind === "range") return { type: raw.type, start: parsed.start, end: parsed.end };
      const date = dateFromParse(ctx, "date_text", value, parsed, "Για ποια μέρα θέλεις το πρόγραμμα;");
      return { type: raw.type, start: date, end: date };
    }
    case "create_invoice":
      return resolveInvoice(ctx, raw);
    case "create_client": {
      const client_name = requireName(ctx, "client_name", "Ποιο είναι το όνομα του πελάτη;");
      const vatRaw = span(ctx, "vat_number_text");
      let vat_number: string | null = null;
      if (vatRaw) {
        const digits = spokenDigits(vatRaw);
        if (digits && isValidAfm(digits)) vat_number = digits;
        else ask(ctx, "vat_number_text", `Ο ΑΦΜ «${vatRaw}» δεν είναι έγκυρος. Ποιος είναι ο σωστός ΑΦΜ;`);
      }
      const phoneRaw = span(ctx, "phone_text");
      const phone = phoneRaw ? spokenDigits(phoneRaw) : null;
      if (phoneRaw && (!phone || phone.length < 10)) {
        ask(ctx, "phone_text", `Δεν κατάλαβα το τηλέφωνο «${phoneRaw}». Ποιο είναι;`);
      }
      const emailRaw = span(ctx, "email_text");
      const email = emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : null;
      if (emailRaw && !email) ask(ctx, "email_text", `Το email «${emailRaw}» δεν είναι έγκυρο. Γράψε το σωστό.`);
      return { type: raw.type, client_name, vat_number, phone: phone && phone.length >= 10 ? phone : null, email };
    }
  }
}

function resolveInvoice(ctx: Ctx, raw: Extract<RawAction, { type: "create_invoice" }>): ResolvedFields {
  const client_name = requireName(ctx, "client_name", "Σε ποιον πελάτη να εκδοθεί;");
  const rawLines = raw.lines.length > 0 ? raw.lines : [{ description: null, quantity_text: null, amount_text: null }];
  const lines = rawLines.map((_, i): ResolvedInvoiceLine => {
    const p = `lines.${i}`;
    const description = span(ctx, `${p}.description`);
    if (!description) ask(ctx, `${p}.description`, "Για ποια υπηρεσία ή είδος είναι η χρέωση;");

    let quantity: string | null = "1";
    const qtyRaw = span(ctx, `${p}.quantity_text`);
    if (qtyRaw) {
      quantity = parseQuantity(qtyRaw);
      if (!quantity) ask(ctx, `${p}.quantity_text`, `Δεν κατάλαβα την ποσότητα «${qtyRaw}». Πόσα τεμάχια/φορές;`);
    } else {
      assume(ctx, `${p}.quantity_text`, "Ποσότητα 1 (δεν αναφέρθηκε ποσότητα).");
    }

    let amount: string | null = null;
    const amountRaw = span(ctx, `${p}.amount_text`);
    if (!amountRaw) {
      ask(ctx, `${p}.amount_text`, "Ποιο είναι το ποσό;");
    } else {
      const parsed = parseMoney(amountRaw);
      if (parsed.kind === "ok" && Number(parsed.amount.replace(".", "")) > 0) amount = parsed.amount;
      else if (parsed.kind === "approximate") ask(ctx, `${p}.amount_text`, `Το ποσό «${amountRaw}» είναι κατά προσέγγιση. Ποιο είναι το ακριβές ποσό;`);
      else ask(ctx, `${p}.amount_text`, `Δεν κατάλαβα το ποσό «${amountRaw}». Ποιο είναι το ποσό σε ευρώ;`);
    }

    let amount_scope: AmountScope | null = "unit";
    const scopeRaw = getPath(ctx.raw, `${p}.amount_scope`);
    if (quantity !== null && quantity !== "1") {
      amount_scope = scopeRaw === "unit" || scopeRaw === "total" ? scopeRaw : null;
      if (!amount_scope && amount) {
        ask(ctx, `${p}.amount_scope`, `Τα ${formatEuro(amount)} είναι η τιμή ανά μονάδα ή το σύνολο για ${quantity};`, [
          { label: `${formatEuro(amount)} ανά μονάδα`, value: "unit" },
          { label: `${formatEuro(amount)} συνολικά`, value: "total" },
        ]);
      }
    }
    return { description, quantity, amount, amount_scope };
  });

  const basisRaw = span(ctx, "price_basis_text");
  let price_basis: PriceBasis | null = basisRaw ? parsePriceBasis(basisRaw) : null;
  if (!price_basis) {
    ask(
      ctx,
      "price_basis_text",
      basisRaw ? `Δεν κατάλαβα αν το «${basisRaw}» περιλαμβάνει ΦΠΑ. Το ποσό είναι με ή χωρίς ΦΠΑ;` : "Το ποσό είναι με ΦΠΑ (τελική τιμή) ή χωρίς ΦΠΑ (καθαρή αξία);",
      [
        { label: "Με ΦΠΑ (τελική τιμή)", value: "με ΦΠΑ" },
        { label: "Χωρίς ΦΠΑ (καθαρή αξία)", value: "χωρίς ΦΠΑ" },
      ],
    );
    price_basis = null;
  }
  return { type: "create_invoice", client_name, lines, price_basis };
}

export function parsePriceBasis(text: string): PriceBasis | null {
  const t = normalizeGreek(text);
  const without = /(πλεον|χωρισ|εκτοσ|συν|\+)\s*(το\s+)?φπα|καθαρ(α|η|ο)|προ φπα/u.test(t);
  const withVat = /(με|μαζι με|συμπεριλαμβανομενου|συμπεριλαμβανεται|μετα)\s*(το\s+)?φπα|τελικ(η|ο)|με ολα/u.test(t);
  if (without === withVat) return null;
  return without ? "without_vat" : "with_vat";
}

function parseQuantity(text: string): string | null {
  const tokens = tokenize(normalizeGreek(text));
  // A trailing unit word ("δύο συνεδρίες", "3 ώρες") is dropped; units of measure come from the catalog later.
  const numeric = tokens.length > 1 && parseGreekDecimal(tokens.join(" ")) === null ? tokens.slice(0, -1) : tokens;
  const value = parseGreekDecimal(numeric.join(" "));
  return value !== null && value !== "0" ? value : null;
}

/** "μηδέν ένα δύο..." or "012 345 678" -> "012345678". */
export function spokenDigits(text: string): string | null {
  let out = "";
  for (const token of tokenize(normalizeGreek(text))) {
    if (/^[\d\s.-]+$/.test(token)) {
      out += token.replace(/\D/g, "");
      continue;
    }
    const v = numberWordValue(token);
    if (v === null) return null;
    out += String(v);
  }
  return out.length > 0 ? out : null;
}

// --- field helpers ---------------------------------------------------------

/**
 * Reads a span from the raw action. Values the LLM produced must appear in
 * the transcript; anything else is treated as missing and asked again, so a
 * hallucinated name or amount can never reach a card silently.
 */
function span(ctx: Ctx, path: string): string | null {
  const value = getPath(ctx.raw, path);
  if (typeof value !== "string" || value.trim() === "") return null;
  if (ctx.userProvided.has(path) || containsSpan(ctx.transcript, value)) return value.trim();
  ask(ctx, path, `Δεν είμαι σίγουρος ότι ειπώθηκε «${value}». Επιβεβαίωσε ή διόρθωσε την τιμή.`, [
    { label: value, value },
  ]);
  return null;
}

function requireName(ctx: Ctx, path: string, message: string): string | null {
  const value = span(ctx, path);
  if (!value && !hasQuestion(ctx, path)) ask(ctx, path, message);
  return value;
}

function resolveDate(ctx: Ctx, path: string, mode: DateMode, missing: string): string | null {
  const value = span(ctx, path);
  if (!value) {
    if (!hasQuestion(ctx, path)) ask(ctx, path, missing);
    return null;
  }
  return dateFromParse(ctx, path, value, parseGreekDate(value, ctx.today, mode), missing);
}

function optionalDate(ctx: Ctx, path: string, mode: DateMode): string | null {
  const value = span(ctx, path);
  return value ? dateFromParse(ctx, path, value, parseGreekDate(value, ctx.today, mode), "Ποια ημερομηνία;") : null;
}

function dateFromParse(
  ctx: Ctx,
  path: string,
  value: string,
  parsed: ReturnType<typeof parseGreekDate>,
  missing: string,
): string | null {
  switch (parsed.kind) {
    case "ok":
      if (parsed.assumedYear) assume(ctx, path, `Η «${value}» θεωρήθηκε για το ${parsed.assumedYear}.`);
      return parsed.date;
    case "ambiguous":
      ask(ctx, path, `Το «${value}» μπορεί να σημαίνει διαφορετικές μέρες. Ποια εννοείς;`, parsed.candidates.map(dateOption));
      return null;
    case "past":
      ask(ctx, path, `Η ημερομηνία ${formatDate(parsed.date)} έχει περάσει. Ποια ημερομηνία εννοείς;`);
      return null;
    case "conflict": {
      const coming = ctx.today.plus({ days: (parsed.weekday - ctx.today.weekday + 7) % 7 || 7 }).toISODate()!;
      ask(ctx, path, `Η ${formatDate(parsed.date)} δεν είναι ${weekdayName(parsed.weekday)}. Ποια ισχύει;`, [
        dateOption(parsed.date),
        dateOption(coming),
      ]);
      return null;
    }
    case "range":
      ask(ctx, path, `Το «${value}» είναι εβδομάδα, όχι συγκεκριμένη μέρα. ${missing}`);
      return null;
    case "invalid":
      ask(ctx, path, `Δεν κατάλαβα την ημερομηνία «${value}». ${missing}`);
      return null;
  }
}

function resolveTime(ctx: Ctx, path: string, missing: string): string | null {
  const value = span(ctx, path);
  if (!value) {
    if (!hasQuestion(ctx, path)) ask(ctx, path, missing);
    return null;
  }
  return timeFromValue(ctx, path, value, missing);
}

function optionalTime(ctx: Ctx, path: string): string | null {
  const value = span(ctx, path);
  return value ? timeFromValue(ctx, path, value, "Τι ώρα;") : null;
}

function timeFromValue(ctx: Ctx, path: string, value: string, missing: string): string | null {
  const parsed = parseGreekTime(value);
  switch (parsed.kind) {
    case "ok":
      return parsed.time;
    case "ambiguous":
      ask(ctx, path, `Το «${value}» είναι πρωί ή απόγευμα;`, parsed.candidates.map((c) => ({ label: timeLabel(c), value: c })));
      return null;
    case "approximate":
      ask(ctx, path, `Το «${value}» είναι κατά προσέγγιση. Ποια ακριβώς ώρα;`);
      return null;
    case "invalid":
      ask(ctx, path, `Δεν κατάλαβα την ώρα «${value}». ${missing}`);
      return null;
  }
}

function timeLabel(time: string): string {
  const hour = Number(time.slice(0, 2));
  const part = hour === 0 ? "μεσάνυχτα" : hour < 12 ? "πρωί" : hour < 13 ? "μεσημέρι" : hour < 20 ? "απόγευμα" : "βράδυ";
  return `${time} ${part}`;
}

function resolveDuration(ctx: Ctx, path: string): number | null {
  const value = span(ctx, path);
  if (!value) {
    if (!hasQuestion(ctx, path)) {
      assume(ctx, path, `Διάρκεια ${DEFAULT_APPOINTMENT_MINUTES}' (προεπιλογή, δεν αναφέρθηκε).`);
      return DEFAULT_APPOINTMENT_MINUTES;
    }
    return null;
  }
  const minutes = parseGreekDuration(value);
  if (minutes === null || minutes > 24 * 60) {
    ask(ctx, path, `Δεν κατάλαβα τη διάρκεια «${value}». Πόσο κρατάει το ραντεβού;`);
    return null;
  }
  return minutes;
}

/** Combines date and time in Europe/Athens; rejects times skipped by the DST change. */
function combine(ctx: Ctx, timePath: string, date: string, time: string): string | null {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: ZONE });
  if (!dt.isValid || dt.toFormat("HH:mm") !== time) {
    ask(ctx, timePath, `Η ώρα ${time} δεν υπάρχει στις ${formatDate(date)} λόγω αλλαγής ώρας. Διάλεξε άλλη ώρα.`);
    return null;
  }
  return dt.toISO({ suppressMilliseconds: true });
}

function ask(ctx: Ctx, field: string, message: string, options?: QuestionOption[]): void {
  if (hasQuestion(ctx, field)) return;
  ctx.questions.push(options ? { field, message, options } : { field, message });
}

function assume(ctx: Ctx, field: string, message: string): void {
  ctx.assumptions.push({ field, message });
}

function hasQuestion(ctx: Ctx, field: string): boolean {
  return ctx.questions.some((q) => q.field === field);
}

function dateOption(date: string): QuestionOption {
  return { label: formatDate(date), value: date };
}

export function formatDate(iso: string): string {
  const d = DateTime.fromISO(iso, { zone: ZONE });
  return `${weekdayName(d.weekday)} ${d.toFormat("d/M/yyyy")}`;
}

export function formatEuro(amount: string): string {
  const [i, f = "00"] = amount.split(".");
  return `${i!.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${f.padEnd(2, "0")} €`;
}

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => (acc == null ? undefined : (acc as Record<string, unknown>)[key]), obj);
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let target: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    if (target[key] == null) target[key] = /^\d+$/.test(keys[i + 1]!) ? [] : {};
    target = target[key] as Record<string, unknown>;
  }
  target[keys[keys.length - 1]!] = value;
}
