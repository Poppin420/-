import { EXTRACTION_SYSTEM_PROMPT } from "./prompt";

/** Swappable LLM backend. Returns the model's JSON (unvalidated). */
export interface IntentLLM {
  extract(transcript: string): Promise<unknown>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

export interface GroqLLMOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Groq's OpenAI-compatible chat completions endpoint in JSON mode. */
export class GroqLLM implements IntentLLM {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: GroqLLMOptions) {
    this.baseUrl = opts.baseUrl ?? "https://api.groq.com/openai/v1";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async extract(transcript: string): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.opts.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
          { role: "user", content: transcript },
        ],
      }),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20_000),
    });
    if (!res.ok) throw new LLMError("LLM request failed", res.status);
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new LLMError("LLM returned no content");
    try {
      return JSON.parse(content);
    } catch {
      throw new LLMError("LLM returned invalid JSON");
    }
  }
}
