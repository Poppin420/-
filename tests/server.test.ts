import { describe, expect, it, vi } from "vitest";
import { configFromEnv, handleParse, handleVoice, type Deps } from "../src/server/handlers";
import { transcribe, TranscriptionError } from "../src/transcription/groqWhisper";
import { GroqLLM, LLMError } from "../src/intent-parsing/llmProvider";
import { REFERENCE_NOW } from "./fixtures/commands";

const TOKEN = "test-access-token-0123456789";
const config = { groqApiKey: "gsk_secret", llmModel: "test-model", accessToken: TOKEN };
const llmOutput = {
  actions: [{ type: "create_appointment", client_name: "Μαρία", date_text: "αύριο", time_text: "στις 5 το απόγευμα" }],
};
const deps = (over: Partial<Deps> = {}): Deps => ({
  config,
  llm: { extract: async () => llmOutput },
  transcribeAudio: async () => "Ραντεβού με τη Μαρία αύριο στις 5 το απόγευμα",
  now: () => REFERENCE_NOW,
  ...over,
});

function voiceRequest(audio: Blob | null, token = TOKEN): Request {
  const form = new FormData();
  if (audio) form.append("audio", audio, "a.webm");
  return new Request("https://x/api/voice", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
}

describe("configFromEnv", () => {
  it("fails closed when keys are missing or the token is weak", () => {
    expect(configFromEnv({})).toBeNull();
    expect(configFromEnv({ GROQ_API_KEY: "k", APP_ACCESS_TOKEN: "short" })).toBeNull();
    expect(configFromEnv({ GROQ_API_KEY: "k", APP_ACCESS_TOKEN: TOKEN })?.llmModel).toBe("llama-3.3-70b-versatile");
  });
});

describe("handleVoice", () => {
  it("transcribes and returns cards", async () => {
    const res = await handleVoice(voiceRequest(new Blob(["x"], { type: "audio/webm" })), deps());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.transcript).toContain("Μαρία");
    expect(body.cards[0].fields.start).toBe("2026-10-22T17:00:00+03:00");
  });

  it("rejects a wrong token", async () => {
    const res = await handleVoice(voiceRequest(new Blob(["x"]), "wrong-token-wrong-token"), deps());
    expect(res.status).toBe(401);
  });

  it("returns 503 when not configured", async () => {
    const res = await handleVoice(voiceRequest(new Blob(["x"])), deps({ config: null }));
    expect(res.status).toBe(503);
  });

  it("rejects missing audio", async () => {
    const res = await handleVoice(voiceRequest(null), deps());
    expect(res.status).toBe(400);
  });

  it("rejects non-POST", async () => {
    const res = await handleVoice(new Request("https://x/api/voice"), deps());
    expect(res.status).toBe(405);
  });

  it("does not leak details when transcription fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleVoice(
      voiceRequest(new Blob(["x"])),
      deps({ transcribeAudio: async () => Promise.reject(new TranscriptionError("boom gsk_secret", 500)) }),
    );
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("gsk_secret");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("gsk_secret");
    spy.mockRestore();
  });
});

describe("handleParse", () => {
  const req = (body: unknown) =>
    new Request("https://x/api/parse", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("parses edited text", async () => {
    const res = await handleParse(req({ text: "Ραντεβού με τη Μαρία αύριο στις 5 το απόγευμα" }), deps());
    expect(res.status).toBe(200);
  });

  it("returns the transcript when the LLM fails so the user can retry", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleParse(req({ text: "κάτι" }), deps({ llm: { extract: async () => ({ nope: 1 }) } }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.transcript).toBe("κάτι");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("κάτι");
    spy.mockRestore();
  });

  it("rejects empty text", async () => {
    expect((await handleParse(req({ text: " " }), deps())).status).toBe(400);
  });
});

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
