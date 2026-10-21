import { timingSafeEqual, createHash } from "node:crypto";
import { parseCommand, ExtractionError, MAX_TRANSCRIPT_CHARS } from "../intent-parsing";
import { GroqLLM, LLMError, type IntentLLM } from "../intent-parsing/llmProvider";
import { transcribe, TranscriptionError, MAX_AUDIO_BYTES } from "../transcription/groqWhisper";

export interface ServerConfig {
  groqApiKey: string;
  llmModel: string;
  accessToken: string;
}

export const DEFAULT_LLM_MODEL = "llama-3.3-70b-versatile";

/** Reads configuration from the environment; returns null when anything is missing (fail closed). */
export function configFromEnv(env: Record<string, string | undefined> = process.env): ServerConfig | null {
  const groqApiKey = env.GROQ_API_KEY;
  const accessToken = env.APP_ACCESS_TOKEN;
  if (!groqApiKey || !accessToken || accessToken.length < 16) return null;
  return { groqApiKey, accessToken, llmModel: env.GROQ_LLM_MODEL || DEFAULT_LLM_MODEL };
}

export interface Deps {
  config: ServerConfig | null;
  llm?: IntentLLM;
  transcribeAudio?: (audio: Blob, filename: string) => Promise<string>;
  now?: () => Date;
}

export async function handleVoice(req: Request, deps: Deps): Promise<Response> {
  const gate = checkRequest(req, deps);
  if (gate) return gate;
  const config = deps.config!;

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_AUDIO_BYTES + 64 * 1024) return error(413, "Η ηχογράφηση είναι πολύ μεγάλη. Δοκίμασε κάτι συντομότερο.");

  let audio: Blob | null = null;
  try {
    const form = await req.formData();
    const entry = form.get("audio");
    audio = entry instanceof Blob ? entry : null;
  } catch {
    return error(400, "Μη έγκυρο αίτημα ήχου.");
  }
  if (!audio || audio.size === 0) return error(400, "Δεν λήφθηκε ήχος.");
  if (audio.size > MAX_AUDIO_BYTES) return error(413, "Η ηχογράφηση είναι πολύ μεγάλη. Δοκίμασε κάτι συντομότερο.");

  const doTranscribe =
    deps.transcribeAudio ?? ((a: Blob, name: string) => transcribe(a, name, { apiKey: config.groqApiKey }));
  let transcript: string;
  try {
    transcript = await doTranscribe(audio, filenameFor(audio.type));
  } catch (e) {
    logFailure("transcription", e);
    return error(502, "Η μεταγραφή απέτυχε. Δοκίμασε ξανά.");
  } finally {
    audio = null;
  }
  if (transcript.length === 0) return error(422, "Δεν αναγνωρίστηκε ομιλία. Δοκίμασε ξανά πιο κοντά στο μικρόφωνο.");
  return parseAndRespond(transcript, deps);
}

export async function handleParse(req: Request, deps: Deps): Promise<Response> {
  const gate = checkRequest(req, deps);
  if (gate) return gate;
  let text: unknown;
  try {
    text = ((await req.json()) as { text?: unknown }).text;
  } catch {
    return error(400, "Μη έγκυρο αίτημα.");
  }
  if (typeof text !== "string" || text.trim().length === 0) return error(400, "Το κείμενο είναι κενό.");
  if (text.length > MAX_TRANSCRIPT_CHARS) return error(413, "Το κείμενο είναι πολύ μεγάλο.");
  return parseAndRespond(text, deps);
}

async function parseAndRespond(transcript: string, deps: Deps): Promise<Response> {
  const llm = deps.llm ?? new GroqLLM({ apiKey: deps.config!.groqApiKey, model: deps.config!.llmModel });
  try {
    const result = await parseCommand(transcript, llm, deps.now?.() ?? new Date());
    return json(200, result);
  } catch (e) {
    logFailure("intent", e);
    // The transcript is still returned so the user can edit it and retry.
    return json(502, {
      error: "Δεν μπόρεσα να καταλάβω την εντολή. Διόρθωσε το κείμενο και δοκίμασε ξανά.",
      transcript,
    });
  }
}

function checkRequest(req: Request, deps: Deps): Response | null {
  if (req.method !== "POST") return error(405, "Μη επιτρεπτή μέθοδος.");
  if (!deps.config) return error(503, "Η υπηρεσία δεν έχει ρυθμιστεί.");
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!safeEqual(token, deps.config.accessToken)) return error(401, "Απαιτείται σύνδεση.");
  return null;
}

function safeEqual(a: string, b: string): boolean {
  // Hash first so the comparison is constant-time regardless of length.
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length > 0;
}

function filenameFor(mime: string): string {
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "audio.m4a";
  if (mime.includes("ogg")) return "audio.ogg";
  if (mime.includes("wav")) return "audio.wav";
  if (mime.includes("mpeg")) return "audio.mp3";
  return "audio.webm";
}

/** Logs only the error class and HTTP status: never transcripts, audio or keys. */
function logFailure(stage: string, e: unknown): void {
  const status = e instanceof LLMError || e instanceof TranscriptionError ? e.status : undefined;
  const kind = e instanceof ExtractionError || e instanceof LLMError || e instanceof TranscriptionError ? e.name : "Error";
  console.error(JSON.stringify({ stage, kind, status }));
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function error(status: number, message: string): Response {
  return json(status, { error: message });
}
