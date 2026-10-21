import { normalizeGreek } from "./greekText";
import { parseGreekDecimal, parseGreekInteger } from "./greekNumbers";

export type MoneyParse =
  | { kind: "ok"; amount: string }
  | { kind: "approximate" }
  | { kind: "invalid" };

// Greek letters are not \w, so word boundaries are spelled out with lookarounds.
const APPROXIMATE = /(?<![\p{L}\d])(περιπου|γυρω|κατι λιγοτερο|κατι παραπανω|πανω κατω|μεχρι)(?![\p{L}\d])/u;
const CURRENCY = /€|(?<![\p{L}\d])(ευρω|eur|euro|euros)(?![\p{L}\d])/gu;
const CENTS = /(?<![\p{L}\d])(λεπτα|λεπτο|σεντσ|cents?)(?![\p{L}\d])/u;

/**
 * Parses an amount in euros from a verbatim span such as "80€", "ογδόντα ευρώ",
 * "1.200,50 €" or "ογδόντα ευρώ και πενήντα λεπτά". The result is a decimal
 * string with exactly two fractional digits. Approximate amounts ("περίπου
 * 80") are reported separately so the caller can ask instead of guessing.
 */
export function parseMoney(span: string): MoneyParse {
  const t = normalizeGreek(span);
  if (APPROXIMATE.test(t)) return { kind: "approximate" };

  if (CENTS.test(t)) {
    const match = /^(.*?)\s*(?:€|ευρω)\s*(?:και\s+)?(.*?)\s*(?:λεπτα|λεπτο|σεντσ|cents?)$/u.exec(t);
    if (!match) return { kind: "invalid" };
    const euros = parseGreekInteger(match[1]!.trim());
    const cents = parseGreekInteger(match[2]!.trim());
    if (euros === null || cents === null || cents > 99) return { kind: "invalid" };
    return { kind: "ok", amount: `${euros}.${String(cents).padStart(2, "0")}` };
  }

  const rest = t.replace(CURRENCY, " ").replace(/\s+/g, " ").trim();
  if (rest.length === 0) return { kind: "invalid" };
  const value = parseGreekDecimal(rest);
  if (value === null) return { kind: "invalid" };
  return toTwoDecimals(value);
}

function toTwoDecimals(value: string): MoneyParse {
  const [intPart, frac = ""] = value.split(".");
  if (frac.length > 2) return { kind: "invalid" };
  return { kind: "ok", amount: `${intPart}.${frac.padEnd(2, "0")}` };
}
