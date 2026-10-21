import { DateTime } from "luxon";
import { normalizeGreek, tokenize } from "./greekText";
import { parseGreekDecimal, parseGreekInteger } from "./greekNumbers";

export const ZONE = "Europe/Athens";

export type DateParse =
  | { kind: "ok"; date: string; assumedYear?: number }
  | { kind: "range"; start: string; end: string }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "past"; date: string }
  | { kind: "conflict"; date: string; weekday: number }
  | { kind: "invalid" };

/** "future": appointments (past dates are flagged); "any": queries. */
export type DateMode = "future" | "any";

const WEEKDAYS: Array<[RegExp, number]> = [
  [/^δευτερα(σ)?$/u, 1],
  [/^τριτη(σ)?$/u, 2],
  [/^τεταρτη(σ)?$/u, 3],
  [/^πεμπτη(σ)?$/u, 4],
  [/^παρασκευη(σ)?$/u, 5],
  [/^σαββατο(υ)?$/u, 6],
  [/^κυριακη(σ)?$/u, 7],
];

const MONTHS: Array<[RegExp, number]> = [
  [/^ιανουαρ(ιοσ|ιου|η)$/u, 1],
  [/^(φεβρουαρ|φλεβαρ)(ιοσ|ιου|η)$/u, 2],
  [/^μαρτ(ιοσ|ιου|η)$/u, 3],
  [/^απριλ(ιοσ|ιου|η)$/u, 4],
  [/^μα(ιοσ|ιου|η)$/u, 5],
  [/^ιουν(ιοσ|ιου|η)$/u, 6],
  [/^ιουλ(ιοσ|ιου|η)$/u, 7],
  [/^αυγουστ(οσ|ου)$/u, 8],
  [/^σεπτεμβρ(ιοσ|ιου|η)$/u, 9],
  [/^(οκτωβρ|οχτωβρ)(ιοσ|ιου|η)$/u, 10],
  [/^νοεμβρ(ιοσ|ιου|η)$/u, 11],
  [/^δεκεμβρ(ιοσ|ιου|η)$/u, 12],
];

const FILLER = new Set(["την", "τη", "το", "του", "τον", "τησ", "στισ", "στην", "στη", "στο", "για", "μεχρι", "απο", "η", "ο"]);
const NEXT_WORDS = new Set(["επομενη", "επομενο", "επομενησ", "αλλη", "αλλο", "αλλησ"]);
const COMING_WORDS = new Set(["ερχομενη", "ερχομενο", "ερχομενησ", "αυτη", "αυτο", "αυτησ"]);
const PAST_WORDS = new Set(["περασμενη", "περασμενο", "περασμενησ", "προηγουμενη", "προηγουμενο", "προηγουμενησ"]);
const WEEK_WORDS = new Set(["εβδομαδα", "βδομαδα", "εβδομαδασ", "βδομαδασ"]);

export function todayInAthens(now: Date = new Date()): DateTime {
  return DateTime.fromJSDate(now, { zone: ZONE }).startOf("day");
}

/**
 * Resolves a Greek date expression relative to `today` (a start-of-day
 * DateTime in Europe/Athens): "αύριο", "την Παρασκευή", "25 Οκτωβρίου",
 * "25/10", "την επόμενη εβδομάδα" and so on. Anything that could reasonably
 * mean two different days is returned as ambiguous.
 */
export function parseGreekDate(span: string, today: DateTime, mode: DateMode = "future"): DateParse {
  const t = normalizeGreek(span).replace(/ που (μασ )?ερχεται$/u, "").replace(/ που ερχεται$/u, "");

  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d = DateTime.fromISO(t, { zone: ZONE });
    return d.isValid ? checkPast(d, today, mode) : { kind: "invalid" };
  }

  const tokens = tokenize(t).filter((tok) => !FILLER.has(tok));
  if (tokens.length === 0) return { kind: "invalid" };

  const single = tokens.length === 1 ? tokens[0] : null;
  if (single === "σημερα") return ok(today);
  if (single === "αυριο") return ok(today.plus({ days: 1 }));
  if (single === "μεθαυριο") return ok(today.plus({ days: 2 }));
  if (single === "χθεσ" || single === "χτεσ") return checkPast(today.minus({ days: 1 }), today, mode);
  if (single === "προχθεσ" || single === "προχτεσ") return checkPast(today.minus({ days: 2 }), today, mode);

  const relative = parseRelativeOffset(tokens);
  if (relative !== undefined) return relative === null ? { kind: "invalid" } : ok(today.plus({ days: relative }));

  const week = parseWeek(tokens, today);
  if (week) return week;

  const weekdayIndex = tokens.findIndex((tok) => WEEKDAYS.some(([re]) => re.test(tok)));
  const explicit = parseExplicitDate(tokens.filter((_, i) => i !== weekdayIndex), today, mode);

  if (weekdayIndex === -1) return explicit ?? { kind: "invalid" };

  const weekday = WEEKDAYS.find(([re]) => re.test(tokens[weekdayIndex]!))![1];
  if (explicit) {
    // "Παρασκευή 23 Οκτωβρίου": the date wins only if the weekday agrees.
    if (explicit.kind !== "ok" && explicit.kind !== "past") return explicit;
    const d = DateTime.fromISO(explicit.date, { zone: ZONE });
    return d.weekday === weekday ? explicit : { kind: "conflict", date: explicit.date, weekday };
  }

  const modifiers = tokens.filter((_, i) => i !== weekdayIndex);
  if (modifiers.length > 1) return { kind: "invalid" };
  const modifier = modifiers[0];
  const daysAhead = (weekday - today.weekday + 7) % 7;
  const coming = today.plus({ days: daysAhead });

  if (modifier === undefined || COMING_WORDS.has(modifier)) {
    if (daysAhead === 0) return { kind: "ambiguous", candidates: [iso(today), iso(today.plus({ days: 7 }))] };
    return ok(coming);
  }
  if (NEXT_WORDS.has(modifier)) {
    const first = daysAhead === 0 ? today.plus({ days: 7 }) : coming;
    return { kind: "ambiguous", candidates: [iso(first), iso(first.plus({ days: 7 }))] };
  }
  if (PAST_WORDS.has(modifier)) {
    const back = (today.weekday - weekday + 7) % 7 || 7;
    return checkPast(today.minus({ days: back }), today, mode);
  }
  return { kind: "invalid" };
}

/** "σε 3 μέρες", "σε μια εβδομάδα". undefined = not this form, null = malformed. */
function parseRelativeOffset(tokens: string[]): number | null | undefined {
  if (tokens[0] !== "σε" || tokens.length < 3) return undefined;
  const unit = tokens[tokens.length - 1]!;
  const isDays = /^(μερ|ημερ)(α|εσ|ων)$/u.test(unit);
  const isWeeks = /^(εβδομαδ|βδομαδ)(α|εσ|ων)$/u.test(unit);
  if (!isDays && !isWeeks) return undefined;
  const n = parseGreekInteger(tokens.slice(1, -1));
  if (n === null || n <= 0) return null;
  return isWeeks ? n * 7 : n;
}

function parseWeek(tokens: string[], today: DateTime): DateParse | null {
  if (!WEEK_WORDS.has(tokens[tokens.length - 1]!)) return null;
  const mods = tokens.slice(0, -1);
  const monday = today.startOf("week");
  if (mods.length === 0 || (mods.length === 1 && (mods[0] === "αυτη" || mods[0] === "αυτησ"))) {
    return range(monday);
  }
  if (mods.length === 1 && (NEXT_WORDS.has(mods[0]!) || mods[0]!.startsWith("ερχομεν"))) {
    return range(monday.plus({ weeks: 1 }));
  }
  if (mods.length === 1 && PAST_WORDS.has(mods[0]!)) return range(monday.minus({ weeks: 1 }));
  return { kind: "invalid" };
}

function parseExplicitDate(tokens: string[], today: DateTime, mode: DateMode): DateParse | null {
  if (tokens.length === 0) return null;

  const numeric = tokens.length === 1 ? /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(tokens[0]!) : null;
  if (numeric) {
    const year = numeric[3] ? normalizeYear(numeric[3]) : undefined;
    return build(Number(numeric[1]), Number(numeric[2]), year, today, mode);
  }

  // "25 του μήνα" -> day of the current month.
  if (tokens[tokens.length - 1] === "μηνα") {
    const day = parseDay(tokens.slice(0, -1));
    return day === null ? { kind: "invalid" } : build(day, today.month, today.year, today, mode);
  }

  const monthIndex = tokens.findIndex((tok) => MONTHS.some(([re]) => re.test(tok)));
  if (monthIndex === -1) return null;
  const month = MONTHS.find(([re]) => re.test(tokens[monthIndex]!))![1];
  const day = parseDay(tokens.slice(0, monthIndex));
  const after = tokens.slice(monthIndex + 1);
  if (day === null || after.length > 1) return { kind: "invalid" };
  let year: number | undefined;
  if (after.length === 1) {
    if (!/^\d{4}$/.test(after[0]!)) return { kind: "invalid" };
    year = Number(after[0]);
  }
  return build(day, month, year, today, mode);
}

function parseDay(tokens: string[]): number | null {
  if (tokens.length === 0) return null;
  if (tokens.length === 1) {
    const ordinal = /^(\d{1,2})(η|ησ)?$/u.exec(tokens[0]!);
    if (ordinal) return Number(ordinal[1]);
    if (tokens[0] === "πρωτη") return 1;
  }
  const n = parseGreekInteger(tokens);
  return n !== null && n >= 1 && n <= 31 ? n : null;
}

function normalizeYear(y: string): number {
  return y.length === 2 ? 2000 + Number(y) : Number(y);
}

function build(day: number, month: number, year: number | undefined, today: DateTime, mode: DateMode): DateParse {
  const d = DateTime.fromObject({ year: year ?? today.year, month, day }, { zone: ZONE });
  if (!d.isValid) return { kind: "invalid" };
  if (year === undefined && mode === "future" && d < today) {
    const next = d.plus({ years: 1 });
    return next.isValid ? { kind: "ok", date: iso(next), assumedYear: next.year } : { kind: "invalid" };
  }
  return checkPast(d, today, mode);
}

function checkPast(d: DateTime, today: DateTime, mode: DateMode): DateParse {
  if (mode === "future" && d < today) return { kind: "past", date: iso(d) };
  return ok(d);
}

function ok(d: DateTime): DateParse {
  return { kind: "ok", date: iso(d) };
}

function range(monday: DateTime): DateParse {
  return { kind: "range", start: iso(monday), end: iso(monday.plus({ days: 6 })) };
}

function iso(d: DateTime): string {
  return d.toISODate()!;
}

/** Parses durations such as "μία ώρα", "μισή ώρα", "45 λεπτά", "ενάμιση ώρα", "1,5 ώρες". Returns minutes. */
export function parseGreekDuration(span: string): number | null {
  const tokens = tokenize(normalizeGreek(span)).filter((tok) => !FILLER.has(tok) && tok !== "για");
  if (tokens.length < 2) return null;
  const unit = tokens[tokens.length - 1]!;
  const amount = parseGreekDecimal(tokens.slice(0, -1).join(" "));
  if (amount === null) return null;
  const [i, f = ""] = amount.split(".");
  // Fractions are limited to halves/quarters so minutes stay integral without floats.
  const quarters = Number(i) * 4 + (f === "" ? 0 : f === "5" ? 2 : f === "25" ? 1 : f === "75" ? 3 : NaN);
  if (!Number.isFinite(quarters) || quarters <= 0) return null;
  if (/^ωρ(α|εσ)$/u.test(unit)) return quarters * 15;
  if (/^λεπτ(α|ο)$/u.test(unit) && f === "") return Number(i);
  return null;
}

export function weekdayName(weekday: number): string {
  return ["", "Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο", "Κυριακή"][weekday] ?? "";
}
