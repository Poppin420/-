import { describe, expect, it } from "vitest";
import { parseCommand, ExtractionError } from "../src/intent-parsing";
import { answerQuestion } from "../src/intent-parsing/resolve";
import type { IntentLLM } from "../src/intent-parsing/llmProvider";
import { COMMAND_CASES, REFERENCE_NOW, checkCase } from "./fixtures/commands";

const fakeLLM = (output: unknown): IntentLLM => ({ extract: async () => output });

describe("Greek command corpus", () => {
  it("has at least 30 cases", () => {
    expect(COMMAND_CASES.length).toBeGreaterThanOrEqual(30);
  });

  it.each(COMMAND_CASES.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const result = await parseCommand(c.transcript, fakeLLM(c.llm), REFERENCE_NOW);
    expect(checkCase(result, c.expect)).toEqual([]);
  });
});

describe("schema enforcement", () => {
  it("rejects unknown action types", async () => {
    await expect(
      parseCommand("Στείλε email στη Μαρία", fakeLLM({ actions: [{ type: "send_email" }] }), REFERENCE_NOW),
    ).rejects.toBeInstanceOf(ExtractionError);
  });

  it("rejects non-JSON-object output", async () => {
    await expect(parseCommand("αύριο", fakeLLM("not json"), REFERENCE_NOW)).rejects.toBeInstanceOf(ExtractionError);
  });

  it("returns no cards for empty transcript without calling the LLM", async () => {
    let called = false;
    const llm: IntentLLM = { extract: async () => ((called = true), {}) };
    expect((await parseCommand("   ", llm, REFERENCE_NOW)).cards).toEqual([]);
    expect(called).toBe(false);
  });
});

describe("answering questions", () => {
  it("resolves an ambiguous time by picking an option", async () => {
    const c = COMMAND_CASES[0]!;
    const { cards } = await parseCommand(c.transcript, fakeLLM(c.llm), REFERENCE_NOW);
    const appt = cards[0]!;
    const q = appt.questions.find((x) => x.field === "time_text")!;
    expect(q.options?.map((o) => o.value)).toEqual(["05:00", "17:00"]);
    const answered = answerQuestion(appt, "time_text", "17:00", c.transcript, REFERENCE_NOW);
    expect(answered.ready).toBe(true);
    expect(answered.id).toBe(appt.id);
    expect(answered.fields).toMatchObject({ start: "2026-10-22T17:00:00+03:00" });
  });

  it("parses typed answers with the same deterministic parsers", async () => {
    const c = COMMAND_CASES[0]!;
    const { cards } = await parseCommand(c.transcript, fakeLLM(c.llm), REFERENCE_NOW);
    let invoice = cards[1]!;
    invoice = answerQuestion(invoice, "lines.0.description", "Μάθημα πιάνου", c.transcript, REFERENCE_NOW);
    invoice = answerQuestion(invoice, "price_basis_text", "με ΦΠΑ", c.transcript, REFERENCE_NOW);
    expect(invoice.ready).toBe(true);
    expect(invoice.fields).toMatchObject({ price_basis: "with_vat", lines: [{ description: "Μάθημα πιάνου", amount: "80.00" }] });
  });

  it("keeps asking when the answer is still invalid", async () => {
    const c = COMMAND_CASES.find((x) => x.name.startsWith("bare invoice"))!;
    const { cards } = await parseCommand(c.transcript, fakeLLM(c.llm), REFERENCE_NOW);
    const answered = answerQuestion(cards[0]!, "lines.0.amount_text", "περίπου εκατό", c.transcript, REFERENCE_NOW);
    expect(answered.questions.some((q) => q.field === "lines.0.amount_text")).toBe(true);
    expect(answered.ready).toBe(false);
  });

  it("asks unit vs total and accepts the choice", async () => {
    const c = COMMAND_CASES.find((x) => x.name.startsWith("quantity > 1"))!;
    const { cards } = await parseCommand(c.transcript, fakeLLM(c.llm), REFERENCE_NOW);
    const answered = answerQuestion(cards[0]!, "lines.0.amount_scope", "total", c.transcript, REFERENCE_NOW);
    expect(answered.ready).toBe(true);
    expect(answered.fields).toMatchObject({ lines: [{ quantity: "2", amount: "50.00", amount_scope: "total" }] });
  });

  it("rejects a time that does not exist because of the spring DST change", async () => {
    const transcript = "Ραντεβού με τη Μαρία 28 Μαρτίου 2027 στις 3:30 το πρωί";
    const { cards } = await parseCommand(
      transcript,
      fakeLLM({ actions: [{ type: "create_appointment", client_name: "Μαρία", date_text: "28 Μαρτίου 2027", time_text: "στις 3:30 το πρωί" }] }),
      REFERENCE_NOW,
    );
    expect(cards[0]!.questions.map((q) => q.field)).toEqual(["time_text"]);
    expect(cards[0]!.fields).toMatchObject({ start: null });
  });
});

describe("checkCase", () => {
  it("reports wrong fields, wrong questions and wrong card counts", async () => {
    const c = COMMAND_CASES[0]!;
    const result = await parseCommand(c.transcript, fakeLLM(c.llm), REFERENCE_NOW);
    expect(checkCase(result, [c.expect[0]!])).toEqual(["expected 1 cards, got 2"]);
    const wrong = [
      { ...c.expect[0]!, fields: { date: "2026-10-23" } },
      { ...c.expect[1]!, asks: [] },
    ];
    expect(checkCase(result, wrong)).toHaveLength(3);
  });
});
