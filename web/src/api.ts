import type { ParseResult } from "@core/intent-parsing";

const TOKEN_KEY = "accessToken";

export function loadToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage may be unavailable (private mode); the token then lasts for this session only.
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly transcript?: string,
  ) {
    super(message);
  }
}

async function handle(res: Response): Promise<ParseResult> {
  const body = (await res.json().catch(() => ({}))) as Partial<ParseResult> & { error?: string };
  if (!res.ok) {
    throw new ApiError(body.error ?? "Κάτι πήγε στραβά. Δοκίμασε ξανά.", res.status, body.transcript);
  }
  return body as ParseResult;
}

export async function sendVoice(audio: Blob, token: string): Promise<ParseResult> {
  const form = new FormData();
  form.append("audio", audio, "voice");
  const res = await fetch("/api/voice", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  return handle(res);
}

export async function sendText(text: string, token: string): Promise<ParseResult> {
  const res = await fetch("/api/parse", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return handle(res);
}
