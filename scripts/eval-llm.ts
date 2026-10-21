/**
 * Runs the Greek command corpus against the real LLM on Groq and reports
 * mismatches. Needs GROQ_API_KEY (and optionally GROQ_LLM_MODEL). This is an
 * evaluation, not a unit test: model output can vary between versions.
 *
 *   GROQ_API_KEY=... npm run eval:llm
 */
import { parseCommand } from "../src/intent-parsing";
import { GroqLLM } from "../src/intent-parsing/llmProvider";
import { DEFAULT_LLM_MODEL } from "../src/server/context";
import { COMMAND_CASES, REFERENCE_NOW, checkCase } from "../tests/fixtures/commands";

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) {
  console.error("GROQ_API_KEY is not set");
  process.exit(2);
}
const model = process.env.GROQ_LLM_MODEL || DEFAULT_LLM_MODEL;
const llm = new GroqLLM({ apiKey, model });

let failed = 0;
for (const c of COMMAND_CASES) {
  let problems: string[];
  try {
    problems = checkCase(await parseCommand(c.transcript, llm, REFERENCE_NOW), c.expect);
  } catch (e) {
    problems = [`error: ${(e as Error).name}`];
  }
  if (problems.length > 0) failed++;
  console.log(`${problems.length === 0 ? "PASS" : "FAIL"}  ${c.name}`);
  for (const p of problems) console.log(`      ${p}`);
}
console.log(`\n${COMMAND_CASES.length - failed}/${COMMAND_CASES.length} passed with ${model}`);
process.exit(failed === 0 ? 0 : 1);
