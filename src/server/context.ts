import type { Db } from "../db/db";
import type { IntentLLM } from "../intent-parsing/llmProvider";
import { GroqLLM } from "../intent-parsing/llmProvider";
import { transcribe } from "../transcription/groqWhisper";
import { SecretBox } from "../security/secretBox";
import { DEFAULT_SCRYPT_LOG_N } from "../security/password";

export const DEFAULT_LLM_MODEL = "llama-3.3-70b-versatile";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface AppConfig {
  /** Public origin of the app, e.g. https://example.netlify.app. Used for Origin checks and OAuth redirects. */
  baseUrl: string | null;
  signupCode: string | null;
  secretBox: SecretBox | null;
  google: GoogleConfig | null;
  scryptLogN: number;
  /** Secure cookies everywhere except plain-http local development. */
  secureCookies: boolean;
}

export interface AppContext {
  db: Db;
  config: AppConfig;
  now: () => Date;
  fetch: typeof fetch;
  llm: IntentLLM | null;
  transcribe: ((audio: Blob, filename: string) => Promise<string>) | null;
}

/** Builds configuration from environment variables. Missing optional features stay disabled (fail closed). */
export function configFromEnv(env: Record<string, string | undefined> = process.env): AppConfig {
  const baseUrl = (env.APP_BASE_URL || env.URL || "").replace(/\/$/, "") || null;
  const secretBox = env.DATA_ENCRYPTION_KEY ? new SecretBox(env.DATA_ENCRYPTION_KEY) : null;
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && baseUrl && secretBox
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: `${baseUrl}/api/google/callback` }
      : null;
  return {
    baseUrl,
    signupCode: env.SIGNUP_CODE && env.SIGNUP_CODE.length >= 8 ? env.SIGNUP_CODE : null,
    secretBox,
    google,
    scryptLogN: DEFAULT_SCRYPT_LOG_N,
    secureCookies: !(baseUrl ?? "").startsWith("http://"),
  };
}

export function groqFromEnv(env: Record<string, string | undefined> = process.env) {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) return { llm: null, transcribe: null };
  return {
    llm: new GroqLLM({ apiKey, model: env.GROQ_LLM_MODEL || DEFAULT_LLM_MODEL }) as IntentLLM,
    transcribe: (audio: Blob, filename: string) => transcribe(audio, filename, { apiKey }),
  };
}
