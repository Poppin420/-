export class TranscriptionError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TranscriptionError";
  }
}

export interface GroqWhisperOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Vocabulary hint so Whisper spells domain terms consistently. Contains no user data. */
const DOMAIN_PROMPT = "Ραντεβού, τιμολόγιο, απόδειξη, ΦΠΑ, ΑΦΜ, ευρώ, αύριο, μεθαύριο, το απόγευμα, το πρωί.";

export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

/**
 * Transcribes Greek speech with Groq Whisper. Audio lives only in memory for
 * the duration of the request and is never written to disk or logged.
 */
export async function transcribe(audio: Blob, filename: string, opts: GroqWhisperOptions): Promise<string> {
  if (audio.size === 0) throw new TranscriptionError("empty audio");
  if (audio.size > MAX_AUDIO_BYTES) throw new TranscriptionError("audio too large");

  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", opts.model ?? "whisper-large-v3");
  form.append("language", "el");
  form.append("response_format", "json");
  form.append("temperature", "0");
  form.append("prompt", DOMAIN_PROMPT);

  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(`${opts.baseUrl ?? "https://api.groq.com/openai/v1"}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
  if (!res.ok) throw new TranscriptionError("transcription request failed", res.status);
  const body = (await res.json()) as { text?: unknown };
  if (typeof body.text !== "string") throw new TranscriptionError("transcription returned no text");
  return body.text.trim();
}
