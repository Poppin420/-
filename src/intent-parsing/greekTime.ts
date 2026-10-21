import { normalizeGreek, tokenize } from "./greekText";
import { parseGreekInteger } from "./greekNumbers";

export type TimeParse =
  | { kind: "ok"; time: string }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "approximate" }
  | { kind: "invalid" };

type Period = "am" | "noon" | "pm" | "evening" | "midnight" | "night";

const B = "(?<![\\p{L}\\d])";
const E = "(?![\\p{L}\\d])";

const PERIODS: Array<[Period, RegExp]> = [
  ["midnight", new RegExp(`${B}(τα )?μεσανυχτα${E}`, "u")],
  ["night", new RegExp(`${B}((τα )?ξημερωματα|(τη |μεσα στη )?νυχτα)${E}`, "u")],
  ["am", new RegExp(`${B}((το |τα )?πρωι(νο)?|π\\.? ?μ\\.?)(?![\\p{L}])`, "u")],
  ["noon", new RegExp(`${B}(το )?μεσημερι${E}`, "u")],
  ["pm", new RegExp(`${B}((το )?απογευμα(τοσ)?|μ\\.? ?μ\\.?)(?![\\p{L}])`, "u")],
  ["evening", new RegExp(`${B}(το )?βραδυ${E}`, "u")],
];

const APPROXIMATE = new RegExp(`${B}(γυρω|περιπου|κατα τισ|καπου)${E}`, "u");
const LEADING = /^(στισ|στη|στην|τισ|την|η ωρα|ωρα|για|ακριβωσ)\s+/u;

/** "πεντέμισι" style compounds, normalized, with ι/η variants unified to ι. */
const HALF_PAST: Record<string, number> = {
  μιαμισι: 1,
  δυομισι: 2,
  τρεισημισι: 3,
  τεσσερισημισι: 4,
  πεντεμισι: 5,
  εξιμισι: 6,
  εφταμισι: 7,
  επταμισι: 7,
  οχτωμισι: 8,
  οκτωμισι: 8,
  εννιαμισι: 9,
  δεκαμισι: 10,
  εντεκαμισι: 11,
  δωδεκαμισι: 12,
};

/**
 * Parses a Greek time expression such as "πέντε το απόγευμα", "17:30",
 * "δέκα παρά τέταρτο το πρωί" or "στις 5". A bare 1–12 hour without a period
 * of day is ambiguous and both candidates are returned so the UI can ask.
 */
export function parseGreekTime(span: string): TimeParse {
  let t = normalizeGreek(span);
  if (APPROXIMATE.test(t)) return { kind: "approximate" };

  let period: Period | null = null;
  for (const [p, re] of PERIODS) {
    if (re.test(t)) {
      if (period !== null) return { kind: "invalid" };
      period = p;
      t = t.replace(re, " ");
    }
  }
  t = t.replace(/\s+/g, " ").trim();
  while (LEADING.test(t)) t = t.replace(LEADING, "");
  t = t.replace(/\s*(η ωρα|ακριβωσ)$/u, "").trim();

  if (t.length === 0) {
    if (period === "noon") return ok(12, 0);
    if (period === "midnight") return ok(0, 0);
    return { kind: "invalid" };
  }

  const clock = parseClock(t);
  if (!clock) return { kind: "invalid" };
  return applyPeriod(clock.hour, clock.minute, period);
}

function parseClock(t: string): { hour: number; minute: number } | null {
  const digital = /^(\d{1,2})[:.](\d{2})$/.exec(t);
  if (digital) return valid(Number(digital[1]), Number(digital[2]));

  const half = HALF_PAST[t.replace(/η$/u, "ι")];
  if (half !== undefined) return { hour: half, minute: 30 };

  const tokens = tokenize(t).filter((tok) => tok !== "λεπτα" && tok !== "λεπτο");
  const sepIndex = tokens.findIndex((tok) => tok === "και" || tok === "παρα");
  if (sepIndex === -1) {
    const hour = parseGreekInteger(tokens);
    return hour === null ? null : valid(hour, 0);
  }

  const hour = parseGreekInteger(tokens.slice(0, sepIndex));
  const minuteTokens = tokens.slice(sepIndex + 1);
  if (hour === null || minuteTokens.length === 0) return null;
  const word = minuteTokens.join(" ");
  const minute =
    word === "μιση" || word === "μισι" ? 30 : word === "τεταρτο" ? 15 : parseGreekInteger(minuteTokens);
  if (minute === null || minute <= 0 || minute >= 60) return null;

  if (tokens[sepIndex] === "και") return valid(hour, minute);
  if (minute > 30 || hour < 1 || hour > 12) return null;
  return valid(hour === 1 ? 12 : hour - 1, 60 - minute);
}

function valid(hour: number, minute: number): { hour: number; minute: number } | null {
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function applyPeriod(hour: number, minute: number, period: Period | null): TimeParse {
  if (hour === 0 || hour >= 13) {
    if (period === null) return ok(hour, minute);
    const fits =
      (period === "pm" && hour >= 13 && hour <= 20) ||
      (period === "evening" && hour >= 17) ||
      (period === "noon" && hour >= 13 && hour <= 16) ||
      ((period === "midnight" || period === "night") && hour === 0);
    return fits ? ok(hour, minute) : { kind: "invalid" };
  }

  switch (period) {
    case null:
      return hour === 12
        ? { kind: "ambiguous", candidates: [fmt(12, minute), fmt(0, minute)] }
        : { kind: "ambiguous", candidates: [fmt(hour, minute), fmt(hour + 12, minute)] };
    case "am":
      return hour === 12 ? { kind: "invalid" } : ok(hour, minute);
    case "noon":
      if (hour === 12) return ok(12, minute);
      return hour <= 4 ? ok(hour + 12, minute) : { kind: "invalid" };
    case "pm":
      return ok(hour === 12 ? 12 : hour + 12, minute);
    case "evening":
      if (hour === 12) return ok(0, minute);
      return hour >= 5 ? ok(hour + 12, minute) : ok(hour, minute);
    case "midnight":
      return hour === 12 ? ok(0, minute) : { kind: "invalid" };
    case "night":
      return hour <= 6 ? ok(hour, minute) : hour === 12 ? ok(0, minute) : { kind: "invalid" };
  }
}

function ok(hour: number, minute: number): TimeParse {
  return { kind: "ok", time: fmt(hour, minute) };
}

function fmt(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
