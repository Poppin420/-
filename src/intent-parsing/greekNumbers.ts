import { normalizeGreek, tokenize } from "./greekText";

const UNITS: Record<string, number> = {
  μηδεν: 0,
  ενα: 1,
  ενασ: 1,
  ενοσ: 1,
  μια: 1,
  μιασ: 1,
  δυο: 2,
  τρια: 3,
  τρεισ: 3,
  τριων: 3,
  τεσσερα: 4,
  τεσσερισ: 4,
  τεσσαρα: 4,
  τεσσαρεσ: 4,
  τεσσαρων: 4,
  πεντε: 5,
  εξι: 6,
  εφτα: 7,
  επτα: 7,
  οχτω: 8,
  οκτω: 8,
  εννια: 9,
  εννεα: 9,
  δεκα: 10,
  εντεκα: 11,
  ενδεκα: 11,
  δωδεκα: 12,
};

const TEEN_SUFFIXES: Record<string, number> = {
  τρια: 3,
  τρεισ: 3,
  τεσσερα: 4,
  τεσσερισ: 4,
  πεντε: 5,
  εξι: 6,
  εφτα: 7,
  επτα: 7,
  οχτω: 8,
  οκτω: 8,
  εννια: 9,
  εννεα: 9,
};

const TENS: Record<string, number> = {
  εικοσι: 20,
  τριαντα: 30,
  σαραντα: 40,
  πενηντα: 50,
  εξηντα: 60,
  εβδομηντα: 70,
  ογδοντα: 80,
  ενενηντα: 90,
};

const HUNDRED_STEMS: Array<[RegExp, number]> = [
  [/^εκατο(ν)?$/, 100],
  [/^διακοσι(α|εσ|οι|ων)$/, 200],
  [/^τριακοσι(α|εσ|οι|ων)$/, 300],
  [/^τετρακοσι(α|εσ|οι|ων)$/, 400],
  [/^πεντακοσι(α|εσ|οι|ων)$/, 500],
  [/^εξακοσι(α|εσ|οι|ων)$/, 600],
  [/^(εφτα|επτα)κοσι(α|εσ|οι|ων)$/, 700],
  [/^(οχτα|οκτα)κοσι(α|εσ|οι|ων)$/, 800],
  [/^(εννια|εννεα)κοσι(α|εσ|οι|ων)$/, 900],
];

/** Value of a single Greek number word below 1000, or null. Input must be normalized. */
export function numberWordValue(word: string): number | null {
  const unit = UNITS[word];
  if (unit !== undefined) return unit;
  if (word.startsWith("δεκα")) {
    const teen = TEEN_SUFFIXES[word.slice(4)];
    if (teen !== undefined) return 10 + teen;
  }
  const ten = TENS[word];
  if (ten !== undefined) return ten;
  // Written-together compounds such as "εικοσιοχτω" or "τριανταπεντε".
  for (const [stem, value] of Object.entries(TENS)) {
    if (word.startsWith(stem)) {
      const unit = UNITS[word.slice(stem.length)];
      if (unit !== undefined && unit >= 1 && unit <= 9) return value + unit;
    }
  }
  for (const [re, value] of HUNDRED_STEMS) {
    if (re.test(word)) return value;
  }
  return null;
}

const STANDALONE_THOUSAND = /^χιλι(α|εσ|ων)$/;
const THOUSANDS_MULTIPLIER = /^χιλιαδ(εσ|ων)$/;

export function isNumberToken(token: string): boolean {
  return (
    /^\d+([.,]\d+)*$/.test(token) ||
    numberWordValue(token) !== null ||
    STANDALONE_THOUSAND.test(token) ||
    THOUSANDS_MULTIPLIER.test(token)
  );
}

/**
 * Parses a non-negative integer written as digits ("125") or Greek words
 * ("εκατόν είκοσι πέντε", "δύο χιλιάδες"). Returns null on anything
 * ambiguous or malformed, e.g. "ογδόντα πενήντα".
 */
export function parseGreekInteger(input: string | string[]): number | null {
  const tokens = (Array.isArray(input) ? input : tokenize(normalizeGreek(input))).filter(
    (t) => t !== "και",
  );
  if (tokens.length === 0) return null;
  if (tokens.length === 1 && /^\d+$/.test(tokens[0]!)) return Number(tokens[0]);

  let total = 0;
  let current = 0;
  let limit = Number.POSITIVE_INFINITY;
  let sawNumber = false;

  for (const token of tokens) {
    if (STANDALONE_THOUSAND.test(token)) {
      if (sawNumber) return null;
      total = 1000;
      limit = 1000;
      sawNumber = true;
      continue;
    }
    if (THOUSANDS_MULTIPLIER.test(token)) {
      if (current === 0 || total !== 0) return null;
      total = current * 1000;
      current = 0;
      limit = 1000;
      continue;
    }
    const value = numberWordValue(token);
    if (value === null || value >= limit) return null;
    if (value === 0 && sawNumber) return null;
    current += value;
    sawNumber = true;
    limit = value >= 100 ? 100 : value >= 20 ? 10 : value === 0 ? 0 : 1;
  }
  return sawNumber ? total + current : null;
}

/**
 * Parses a non-negative decimal written with digits (Greek "1.200,50" or
 * "80.5") or as Greek integer words. Returns a canonical string like "1200.5"
 * so callers never pass through floating point.
 */
export function parseGreekDecimal(input: string): string | null {
  const n = normalizeGreek(input).replace(/\s+/g, " ");
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(n) || /^\d+,\d+$/.test(n) || /^\d+$/.test(n)) {
    const [intPart, frac] = n.replace(/\./g, "").split(",");
    return canonicalDecimal(intPart!, frac ?? "");
  }
  if (/^\d+\.\d{1,2}$/.test(n)) {
    const [intPart, frac] = n.split(".");
    return canonicalDecimal(intPart!, frac!);
  }
  const special = HALF_WORDS[n];
  if (special) return special;
  const value = parseGreekInteger(n);
  return value === null ? null : String(value);
}

const HALF_WORDS: Record<string, string> = {
  μιση: "0.5",
  μισο: "0.5",
  μισι: "0.5",
  εναμιση: "1.5",
  εναμισι: "1.5",
  μιαμιση: "1.5",
  μιαμισι: "1.5",
};

function canonicalDecimal(intPart: string, frac: string): string {
  const i = intPart.replace(/^0+(?=\d)/, "");
  const f = frac.replace(/0+$/, "");
  return f.length > 0 ? `${i}.${f}` : i;
}
