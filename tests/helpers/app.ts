import { randomBytes } from "node:crypto";
import { createApp } from "../../src/server/app";
import type { AppContext } from "../../src/server/context";
import type { IntentLLM } from "../../src/intent-parsing/llmProvider";
import { SecretBox } from "../../src/security/secretBox";
import type { Db } from "../../src/db/db";
import { REFERENCE_NOW } from "../fixtures/commands";

export const BASE = "https://app.test";
export const SIGNUP_CODE = "invite-code-1";

export interface FakeGoogle {
  calls: Array<{ method: string; url: string; body: string }>;
  events: Map<string, Record<string, unknown>>;
  busy: Array<{ start: string; end: string }>;
  failWrites: boolean;
}

/**
 * Test context: real Postgres (PGlite), fixed clock, LLM that returns a queued
 * extraction, and an in-memory fake of the Google OAuth + Calendar endpoints.
 */
export function makeContext(db: Db, over: Partial<AppContext> = {}) {
  const google: FakeGoogle = { calls: [], events: new Map(), busy: [], failWrites: false };
  let nextExtraction: unknown = { actions: [] };
  let nextTranscript = "";

  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body instanceof URLSearchParams ? init.body.toString() : typeof init?.body === "string" ? init.body : "";
    google.calls.push({ method, url, body });
    const ok = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

    if (url === "https://oauth2.googleapis.com/token") {
      const p = new URLSearchParams(body);
      if (p.get("grant_type") === "authorization_code") {
        return p.get("code") === "good-code" && p.get("code_verifier")
          ? ok({ access_token: "at-1", refresh_token: "refresh-secret-1" })
          : ok({ error: "invalid_grant" }, 400);
      }
      return p.get("refresh_token") === "refresh-secret-1" ? ok({ access_token: "at-2" }) : ok({ error: "invalid_grant" }, 400);
    }
    if (url.startsWith("https://oauth2.googleapis.com/revoke")) return ok({});
    if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/primary/events")) {
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      if (auth !== "Bearer at-2") return ok({ error: "unauthorized" }, 401);
      const id = url.split("/events/")[1];
      if (method === "GET") {
        return ok({
          items: google.busy.map((b, i) => ({ id: `ext-${i}`, status: "confirmed", start: { dateTime: b.start }, end: { dateTime: b.end } })),
        });
      }
      if (google.failWrites) return ok({ error: "backend" }, 503);
      if (method === "POST") {
        const eid = `evt-${google.events.size + 1}`;
        google.events.set(eid, JSON.parse(body));
        return ok({ id: eid });
      }
      if (method === "PATCH" && id) {
        google.events.set(decodeURIComponent(id), JSON.parse(body));
        return ok({ id: decodeURIComponent(id) });
      }
      if (method === "DELETE" && id) {
        google.events.delete(decodeURIComponent(id));
        return new Response(null, { status: 204 });
      }
    }
    return ok({ error: "unexpected request" }, 500);
  }) as typeof fetch;

  const llm: IntentLLM = { extract: async () => nextExtraction };
  const ctx: AppContext = {
    db,
    config: {
      baseUrl: BASE,
      signupCode: SIGNUP_CODE,
      secretBox: new SecretBox(randomBytes(32).toString("base64")),
      google: { clientId: "cid", clientSecret: "csecret", redirectUri: `${BASE}/api/google/callback` },
      scryptLogN: 10,
      secureCookies: true,
    },
    now: () => REFERENCE_NOW,
    fetch: fakeFetch,
    llm,
    transcribe: async () => nextTranscript,
    ...over,
  };
  return {
    ctx,
    google,
    app: createApp(ctx),
    /** Queue what the "LLM" returns next (and the transcript for /api/voice). */
    willExtract(extraction: unknown, transcript = "") {
      nextExtraction = extraction;
      nextTranscript = transcript;
    },
  };
}

export interface CallOptions {
  body?: unknown;
  form?: FormData;
  cookie?: string;
  origin?: string | null;
}

export async function call(app: (req: Request) => Promise<Response>, method: string, path: string, opts: CallOptions = {}) {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.origin !== null && method !== "GET") headers.Origin = opts.origin ?? BASE;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await app(new Request(`${BASE}${path}`, { method, headers, body }));
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, json, text };
}

let counter = 0;
/** Signs up a fresh user and returns the session cookie. */
export async function signedIn(app: (req: Request) => Promise<Response>): Promise<string> {
  const email = `user${++counter}-${randomBytes(3).toString("hex")}@example.gr`;
  const res = await call(app, "POST", "/api/auth/signup", {
    body: { email, password: "correct horse battery", signupCode: SIGNUP_CODE },
  });
  if (res.status !== 201) throw new Error(`signup failed: ${res.text}`);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}
