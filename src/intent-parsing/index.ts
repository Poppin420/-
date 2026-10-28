import { RawExtraction } from "./schema";
import type { IntentLLM } from "./llmProvider";
import { resolveAction, type ActionCard } from "./resolve";

export interface ParseResult {
  transcript: string;
  cards: ActionCard[];
  unrecognized: string[];
}

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

export const MAX_TRANSCRIPT_CHARS = 2000;

/** Transcript -> LLM extraction -> schema validation -> deterministic cards. */
export async function parseCommand(transcript: string, llm: IntentLLM, now: Date = new Date()): Promise<ParseResult> {
  const text = transcript.trim();
  if (text.length === 0) return { transcript: text, cards: [], unrecognized: [] };
  if (text.length > MAX_TRANSCRIPT_CHARS) throw new ExtractionError("transcript too long");

  const parsed = RawExtraction.safeParse(await llm.extract(text));
  if (!parsed.success) throw new ExtractionError("LLM output did not match the schema");

  return {
    transcript: text,
    cards: parsed.data.actions.map((action) => resolveAction(action, text, now)),
    unrecognized: parsed.data.unrecognized,
  };
}
