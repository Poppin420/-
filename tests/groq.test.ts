import { describe, expect, it, vi } from "vitest";
import { transcribe, TranscriptionError } from "../src/transcription/groqWhisper";
import { GroqLLM, LLMError } from "../src/intent-parsing/llmProvider";

describe("Groq clients", () => {
  it("sends Whisper the expected fields and key", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const form = init!.body as FormData;
      expect(form.get("model")).toBe("whisper-large-v3");
      expect(form.get("language")).toBe("el");
      expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer k");
      return new Response(JSON.stringify({ text: " Γεια σου " }));
    });
    const text = await transcribe(new Blob(["x"]), "a.webm", { apiKey: "k", fetchImpl: fetchImpl as typeof fetch });
    expect(text).toBe("Γεια σου");
    expect(String(fetchImpl.mock.calls[0]![0])).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
  });

  it("rejects oversized audio before calling the API", async () => {
    const fetchImpl = vi.fn();
    await expect(
      transcribe(new Blob([new Uint8Array(6 * 1024 * 1024)]), "a.webm", { apiKey: "k", fetchImpl: fetchImpl as typeof fetch }),
    ).rejects.toBeInstanceOf(TranscriptionError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("calls the LLM in JSON mode with temperature 0 and parses content", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      expect(body.temperature).toBe(0);
      expect(body.response_format).toEqual({ type: "json_object" });
      expect(body.messages[1]).toEqual({ role: "user", content: "αύριο" });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"actions":[]}' } }] }));
    });
    const llm = new GroqLLM({ apiKey: "k", model: "m", fetchImpl: fetchImpl as typeof fetch });
    expect(await llm.extract("αύριο")).toEqual({ actions: [] });
  });

  it("surfaces LLM HTTP errors with status only", async () => {
    const fetchImpl = vi.fn(async () => new Response("rate limited", { status: 429 }));
    const llm = new GroqLLM({ apiKey: "k", model: "m", fetchImpl: fetchImpl as typeof fetch });
    await expect(llm.extract("x")).rejects.toMatchObject({ name: "LLMError", status: 429 });
    await expect(llm.extract("x")).rejects.toBeInstanceOf(LLMError);
  });
});
