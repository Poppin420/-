/**
 * Normalizes Greek text for matching: lowercase, strips accents/diaeresis,
 * maps final sigma to sigma and collapses whitespace.
 */
export function normalizeGreek(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .replace(/[«»"“”„]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits normalized text into word/number tokens, keeping €, :, ., , and / inside tokens. */
export function tokenize(normalized: string): string[] {
  return normalized
    .replace(/€/g, " € ")
    .split(/[\s;!?()\[\]]+/)
    .map((t) => t.replace(/^[,.]+|[,.]+$/g, ""))
    .filter((t) => t.length > 0);
}

/**
 * True when `span` occurs in `text` after normalization. Used to reject values
 * the LLM did not take verbatim from the transcript.
 */
export function containsSpan(text: string, span: string): boolean {
  const n = normalizeGreek(span).replace(/[.,]+$/, "");
  if (n.length === 0) return false;
  return normalizeGreek(text).includes(n);
}
