import { DateTime } from "luxon";
import type { AppContext } from "./context";
import {
  authenticate,
  clearSessionCookie,
  createSession,
  destroySession,
  login,
  sessionCookie,
  signup,
  type SessionUser,
} from "../auth/auth";
import { parseCommand, MAX_TRANSCRIPT_CHARS, type ParseResult } from "../intent-parsing";
import { MAX_AUDIO_BYTES } from "../transcription/groqWhisper";
import { CardInput, executeCard, previewCard, rebuildCard, type CardPreview } from "../actions/actions";
import { cancelAppointment, getAppointment, listAppointments } from "../calendar/appointments";
import { disconnect, finishConnect, isConnected, startConnect, syncToGoogle } from "../calendar/google";
import { listClients } from "../clients/clients";
import { ZONE } from "../intent-parsing/greekDate";
import { verifyPassword } from "../security/password";
import { exportUserData } from "../privacy/privacy";

type Handler = (req: Request, ctx: AppContext, user: SessionUser | null, params: Record<string, string>) => Promise<Response>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  auth: boolean;
  handler: Handler;
}

const routes: Route[] = [];
function route(method: string, path: string, auth: boolean, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp(`^${path.replace(/:(\w+)/g, (_, k: string) => (keys.push(k), "([^/]+)"))}$`);
  routes.push({ method, pattern, keys, auth, handler });
}

/** Single entry point for all /api routes. */
export function createApp(ctx: AppContext): (req: Request) => Promise<Response> {
  return async (req) => {
    const url = new URL(req.url);
    const match = routes
      .map((r) => ({ r, m: r.method === req.method ? r.pattern.exec(url.pathname) : null }))
      .find((x) => x.m);
    if (!match) {
      const exists = routes.some((r) => r.pattern.test(url.pathname));
      return error(exists ? 405 : 404, exists ? "Μη επιτρεπτή μέθοδος." : "Δεν βρέθηκε.");
    }
    if (req.method !== "GET" && !sameOrigin(req, ctx)) return error(403, "Μη επιτρεπτή προέλευση αιτήματος.");
    try {
      const user = await authenticate(ctx, req);
      if (match.r.auth && !user) return error(401, "Απαιτείται σύνδεση.");
      const params = Object.fromEntries(match.r.keys.map((k, i) => [k, decodeURIComponent(match.m![i + 1]!)]));
      return await match.r.handler(req, ctx, user, params);
    } catch (e) {
      console.error(JSON.stringify({ stage: "api", path: url.pathname, kind: (e as Error).name }));
      return error(500, "Κάτι πήγε στραβά. Δοκίμασε ξανά.");
    }
  };
}

/** Browsers send Origin on cross-site POSTs; reject any that is not ours. */
function sameOrigin(req: Request, ctx: AppContext): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  return origin === (ctx.config.baseUrl ?? new URL(req.url).origin);
}

// --- auth -------------------------------------------------------------------

route("POST", "/api/auth/signup", false, async (req, ctx) => {
  const body = await readJson(req);
  const r = await signup(ctx, str(body.email), str(body.password), str(body.signupCode));
  if (!r.ok) return error(r.status, r.message);
  return withSession(ctx, r.userId, 201);
});

route("POST", "/api/auth/login", false, async (req, ctx) => {
  const body = await readJson(req);
  const r = await login(ctx, str(body.email), str(body.password));
  if (!r.ok) return error(r.status, r.message);
  return withSession(ctx, r.userId, 200);
});

route("POST", "/api/auth/logout", false, async (req, ctx) => {
  await destroySession(ctx, req);
  return json(200, { ok: true }, { "Set-Cookie": clearSessionCookie(ctx) });
});

route("GET", "/api/auth/me", true, async (_req, ctx, user) =>
  json(200, { user, google: { available: !!ctx.config.google, connected: await isConnected(ctx, user!.id) } }),
);

async function withSession(ctx: AppContext, userId: string, status: number): Promise<Response> {
  const token = await createSession(ctx, userId);
  return json(status, { ok: true }, { "Set-Cookie": sessionCookie(ctx, token) });
}

// --- voice and text commands ------------------------------------------------

route("POST", "/api/voice", true, async (req, ctx, user) => {
  if (!ctx.transcribe || !ctx.llm) return error(503, "Η φωνητική υπηρεσία δεν έχει ρυθμιστεί.");
  if (Number(req.headers.get("content-length") ?? "0") > MAX_AUDIO_BYTES + 64 * 1024) {
    return error(413, "Η ηχογράφηση είναι πολύ μεγάλη. Δοκίμασε κάτι συντομότερο.");
  }
  let audio: Blob | null = null;
  try {
    const entry = (await req.formData()).get("audio");
    audio = entry instanceof Blob ? entry : null;
  } catch {
    return error(400, "Μη έγκυρο αίτημα ήχου.");
  }
  if (!audio || audio.size === 0) return error(400, "Δεν λήφθηκε ήχος.");
  if (audio.size > MAX_AUDIO_BYTES) return error(413, "Η ηχογράφηση είναι πολύ μεγάλη. Δοκίμασε κάτι συντομότερο.");

  let transcript: string;
  try {
    transcript = await ctx.transcribe(audio, filenameFor(audio.type));
  } catch (e) {
    logFailure("transcription", e);
    return error(502, "Η μεταγραφή απέτυχε. Δοκίμασε ξανά.");
  } finally {
    audio = null; // audio is never stored
  }
  if (transcript.length === 0) return error(422, "Δεν αναγνωρίστηκε ομιλία. Δοκίμασε ξανά πιο κοντά στο μικρόφωνο.");
  return parseAndPreview(ctx, user!, transcript);
});

route("POST", "/api/parse", true, async (req, ctx, user) => {
  if (!ctx.llm) return error(503, "Η υπηρεσία ανάλυσης δεν έχει ρυθμιστεί.");
  const text = (await readJson(req)).text;
  if (typeof text !== "string" || text.trim().length === 0) return error(400, "Το κείμενο είναι κενό.");
  if (text.length > MAX_TRANSCRIPT_CHARS) return error(413, "Το κείμενο είναι πολύ μεγάλο.");
  return parseAndPreview(ctx, user!, text);
});

export interface CommandResponse extends Omit<ParseResult, "cards"> {
  previews: CardPreview[];
}

async function parseAndPreview(ctx: AppContext, user: SessionUser, transcript: string): Promise<Response> {
  let parsed: ParseResult;
  try {
    parsed = await parseCommand(transcript, ctx.llm!, ctx.now());
  } catch (e) {
    logFailure("intent", e);
    return json(502, { error: "Δεν μπόρεσα να καταλάβω την εντολή. Διόρθωσε το κείμενο και δοκίμασε ξανά.", transcript });
  }
  const previews = [];
  for (const card of parsed.cards) previews.push(await previewCard(ctx, user.id, card));
  const body: CommandResponse = { transcript: parsed.transcript, unrecognized: parsed.unrecognized, previews };
  return json(200, body);
}

// --- card preview / execution -----------------------------------------------

route("POST", "/api/actions/preview", true, async (req, ctx, user) => {
  const input = CardInput.safeParse(await readJson(req));
  if (!input.success) return error(400, "Μη έγκυρη κάρτα.");
  const card = rebuildCard(input.data, ctx.now());
  return json(200, await previewCard(ctx, user!.id, card, input.data.choices));
});

route("POST", "/api/actions/execute", true, async (req, ctx, user) => {
  const input = CardInput.safeParse(await readJson(req));
  if (!input.success) return error(400, "Μη έγκυρη κάρτα.");
  const outcome = await executeCard(ctx, user!.id, input.data);
  switch (outcome.kind) {
    case "done":
      return json(200, outcome.result);
    case "not_ready":
      return json(422, { error: "Η κάρτα έχει ακόμη ερωτήσεις χωρίς απάντηση.", preview: outcome.preview });
    case "blocked":
      return json(409, { error: outcome.preview.context.blockers.join(" "), preview: outcome.preview });
    case "conflict":
      return json(409, { error: outcome.message, preview: outcome.preview });
  }
});

// --- calendar ---------------------------------------------------------------

route("GET", "/api/appointments", true, async (req, ctx, user) => {
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? from;
  const f = DateTime.fromISO(from, { zone: ZONE });
  const t = DateTime.fromISO(to, { zone: ZONE });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !f.isValid || !t.isValid || t < f) {
    return error(400, "Μη έγκυρο διάστημα ημερομηνιών.");
  }
  if (t.diff(f, "days").days > 62) return error(400, "Το διάστημα είναι πολύ μεγάλο.");
  return json(200, { appointments: await listAppointments(ctx.db, user!.id, from, to) });
});

route("POST", "/api/appointments/:id/cancel", true, async (_req, ctx, user, { id }) => {
  const cancelled = await cancelAppointment(ctx.db, user!.id, id!);
  if (!cancelled) return error(404, "Το ραντεβού δεν βρέθηκε ή έχει ήδη ακυρωθεί.");
  cancelled.google_sync_status = await syncToGoogle(ctx, user!.id, cancelled);
  return json(200, { appointment: cancelled });
});

route("POST", "/api/appointments/:id/sync", true, async (_req, ctx, user, { id }) => {
  const appointment = await getAppointment(ctx.db, user!.id, id!);
  if (!appointment) return error(404, "Το ραντεβού δεν βρέθηκε.");
  appointment.google_sync_status = await syncToGoogle(ctx, user!.id, appointment);
  return json(200, { appointment });
});

route("GET", "/api/clients", true, async (_req, ctx, user) => json(200, { clients: await listClients(ctx.db, user!.id) }));

// --- Google Calendar ----------------------------------------------------------

route("POST", "/api/google/connect", true, async (_req, ctx, user) => {
  if (!ctx.config.google) return error(503, "Η σύνδεση με Google Calendar δεν έχει ρυθμιστεί.");
  return json(200, { url: await startConnect(ctx, user!.id) });
});

route("GET", "/api/google/callback", true, async (req, ctx, user) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  let outcome = "error";
  if (code && state && ctx.config.google) {
    try {
      await finishConnect(ctx, user!.id, state, code);
      outcome = "connected";
    } catch (e) {
      logFailure("google-connect", e);
    }
  }
  return new Response(null, { status: 303, headers: { Location: `/#/settings?google=${outcome}`, "Cache-Control": "no-store" } });
});

route("POST", "/api/google/disconnect", true, async (_req, ctx, user) => {
  await disconnect(ctx, user!.id);
  return json(200, { ok: true });
});

// --- account / GDPR -----------------------------------------------------------

route("GET", "/api/account/export", true, async (_req, ctx, user) => {
  const data = await exportUserData(ctx.db, user!.id);
  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="ta-dedomena-mou.json"',
      "Cache-Control": "no-store",
    },
  });
});

route("POST", "/api/account/delete", true, async (req, ctx, user) => {
  const password = str((await readJson(req)).password);
  const [row] = await ctx.db.query<{ password_hash: string }>("select password_hash from users where id = $1", [user!.id]);
  if (!row || !(await verifyPassword(password, row.password_hash))) return error(403, "Λάθος κωδικός.");
  await disconnect(ctx, user!.id).catch(() => {});
  await ctx.db.query("delete from users where id = $1", [user!.id]);
  return json(200, { ok: true }, { "Set-Cookie": clearSessionCookie(ctx) });
});

// --- helpers ------------------------------------------------------------------

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function filenameFor(mime: string): string {
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "audio.m4a";
  if (mime.includes("ogg")) return "audio.ogg";
  if (mime.includes("wav")) return "audio.wav";
  if (mime.includes("mpeg")) return "audio.mp3";
  return "audio.webm";
}

/** Logs only the stage, error class and HTTP status: never transcripts, audio, tokens or keys. */
function logFailure(stage: string, e: unknown): void {
  const err = e as { name?: string; status?: number };
  console.error(JSON.stringify({ stage, kind: err.name ?? "Error", status: err.status }));
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function error(status: number, message: string): Response {
  return json(status, { error: message });
}
