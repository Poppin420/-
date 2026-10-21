import { createHash, randomBytes } from "node:crypto";
import { DateTime } from "luxon";
import type { AppContext } from "../server/context";
import { sha256 } from "../auth/auth";
import { ZONE } from "../intent-parsing/greekDate";
import { setGoogleSync, type Appointment } from "./appointments";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/calendar/v3";
/** Narrowest scope that allows creating events and reading busy times. */
export const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const PURPOSE_TOKEN = "google-refresh-token";
const PURPOSE_VERIFIER = "google-pkce-verifier";
const STATE_MINUTES = 10;

export class GoogleError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GoogleError";
  }
}

function requireGoogle(ctx: AppContext) {
  const { google, secretBox } = ctx.config;
  if (!google || !secretBox) throw new GoogleError("google integration is not configured");
  return { google, secretBox };
}

/** Starts OAuth with PKCE; returns the Google consent URL. */
export async function startConnect(ctx: AppContext, userId: string): Promise<string> {
  const { google, secretBox } = requireGoogle(ctx);
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  await ctx.db.query("delete from oauth_states where user_id = $1 or expires_at < $2", [userId, ctx.now()]);
  await ctx.db.query(
    "insert into oauth_states (state_hash, user_id, code_verifier_enc, expires_at) values ($1, $2, $3, $4)",
    [sha256(state), userId, secretBox.seal(verifier, userId, PURPOSE_VERIFIER), new Date(ctx.now().getTime() + STATE_MINUTES * 60_000)],
  );
  const params = new URLSearchParams({
    client_id: google.clientId,
    redirect_uri: google.redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${params}`;
}

/** Completes OAuth. The state must belong to the signed-in user and be unexpired; it is single-use. */
export async function finishConnect(ctx: AppContext, userId: string, state: string, code: string): Promise<void> {
  const { google, secretBox } = requireGoogle(ctx);
  const [row] = await ctx.db.query<{ code_verifier_enc: string }>(
    "delete from oauth_states where state_hash = $1 and user_id = $2 and expires_at > $3 returning code_verifier_enc",
    [sha256(state), userId, ctx.now()],
  );
  if (!row) throw new GoogleError("invalid or expired state");
  const verifier = secretBox.open(row.code_verifier_enc, userId, PURPOSE_VERIFIER);

  const tokens = await tokenRequest(ctx, {
    grant_type: "authorization_code",
    code,
    client_id: google.clientId,
    client_secret: google.clientSecret,
    redirect_uri: google.redirectUri,
    code_verifier: verifier,
  });
  if (typeof tokens.refresh_token !== "string") throw new GoogleError("no refresh token returned");
  await ctx.db.query(
    `insert into google_connections (user_id, refresh_token_enc) values ($1, $2)
     on conflict (user_id) do update set refresh_token_enc = excluded.refresh_token_enc, created_at = now()`,
    [userId, secretBox.seal(tokens.refresh_token, userId, PURPOSE_TOKEN)],
  );
}

export async function isConnected(ctx: AppContext, userId: string): Promise<boolean> {
  const rows = await ctx.db.query("select 1 from google_connections where user_id = $1", [userId]);
  return rows.length > 0;
}

/** Revokes the token at Google (best effort) and deletes it locally. */
export async function disconnect(ctx: AppContext, userId: string): Promise<void> {
  const refresh = await loadRefreshToken(ctx, userId);
  await ctx.db.query("delete from google_connections where user_id = $1", [userId]);
  if (refresh) {
    await ctx
      .fetch(REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refresh }),
        signal: AbortSignal.timeout(10_000),
      })
      .catch(() => {});
  }
}

async function loadRefreshToken(ctx: AppContext, userId: string): Promise<string | null> {
  const [row] = await ctx.db.query<{ refresh_token_enc: string }>(
    "select refresh_token_enc from google_connections where user_id = $1",
    [userId],
  );
  if (!row || !ctx.config.secretBox) return null;
  return ctx.config.secretBox.open(row.refresh_token_enc, userId, PURPOSE_TOKEN);
}

async function accessToken(ctx: AppContext, userId: string): Promise<string | null> {
  const { google } = requireGoogle(ctx);
  const refresh = await loadRefreshToken(ctx, userId);
  if (!refresh) return null;
  try {
    const tokens = await tokenRequest(ctx, {
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: google.clientId,
      client_secret: google.clientSecret,
    });
    if (typeof tokens.access_token !== "string") throw new GoogleError("no access token returned");
    return tokens.access_token;
  } catch (e) {
    // A revoked grant cannot recover; drop the connection so the UI shows "not connected".
    if (e instanceof GoogleError && e.message === "invalid_grant") {
      await ctx.db.query("delete from google_connections where user_id = $1", [userId]);
    }
    throw e;
  }
}

async function tokenRequest(ctx: AppContext, body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await ctx.fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new GoogleError(typeof json.error === "string" ? json.error : "token request failed", res.status);
  return json;
}

async function api(ctx: AppContext, token: string, method: string, path: string, body?: unknown): Promise<Response> {
  return ctx.fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
}

function eventBody(a: Appointment) {
  return {
    summary: a.title ? `${a.client_name} – ${a.title}` : a.client_name,
    start: { dateTime: a.starts_at, timeZone: ZONE },
    end: { dateTime: a.ends_at, timeZone: ZONE },
    extendedProperties: { private: { appointmentId: a.id } },
  };
}

export interface BusySlot {
  start: string;
  end: string;
}

/**
 * Busy times in the user's Google calendar that did not come from this app.
 * Event titles are not returned: only the time slots are needed.
 */
export async function googleBusy(ctx: AppContext, userId: string, start: Date, end: Date): Promise<BusySlot[] | null> {
  if (!ctx.config.google || !(await isConnected(ctx, userId))) return null;
  const token = await accessToken(ctx, userId);
  if (!token) return null;
  const params = new URLSearchParams({
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: "true",
    maxResults: "50",
  });
  const res = await api(ctx, token, "GET", `/calendars/primary/events?${params}`);
  if (!res.ok) throw new GoogleError("events list failed", res.status);
  const { items = [] } = (await res.json()) as {
    items?: Array<{
      status?: string;
      transparency?: string;
      start?: { dateTime?: string };
      end?: { dateTime?: string };
      extendedProperties?: { private?: { appointmentId?: string } };
    }>;
  };
  return items
    .filter((e) => e.status !== "cancelled" && e.transparency !== "transparent")
    .filter((e) => !e.extendedProperties?.private?.appointmentId)
    .filter((e) => e.start?.dateTime && e.end?.dateTime) // all-day events are not treated as busy
    .map((e) => ({ start: athens(e.start!.dateTime!), end: athens(e.end!.dateTime!) }));
}

function athens(iso: string): string {
  return DateTime.fromISO(iso, { setZone: true }).setZone(ZONE).toISO({ suppressMilliseconds: true })!;
}

/**
 * Mirrors an appointment change to Google. Failures never undo the local
 * change: the appointment is marked "failed" and can be retried.
 */
export async function syncToGoogle(ctx: AppContext, userId: string, a: Appointment): Promise<Appointment["google_sync_status"]> {
  if (!ctx.config.google || !(await isConnected(ctx, userId))) return a.google_sync_status;
  try {
    const token = await accessToken(ctx, userId);
    if (!token) return a.google_sync_status;
    if (a.status === "cancelled") {
      if (a.google_event_id) {
        const res = await api(ctx, token, "DELETE", `/calendars/primary/events/${encodeURIComponent(a.google_event_id)}`);
        if (!res.ok && res.status !== 404 && res.status !== 410) throw new GoogleError("delete failed", res.status);
      }
      await setGoogleSync(ctx.db, userId, a.id, "synced");
      return "synced";
    }
    const res = a.google_event_id
      ? await api(ctx, token, "PATCH", `/calendars/primary/events/${encodeURIComponent(a.google_event_id)}`, eventBody(a))
      : await api(ctx, token, "POST", "/calendars/primary/events", eventBody(a));
    if (!res.ok) throw new GoogleError("event write failed", res.status);
    const { id } = (await res.json()) as { id?: string };
    await setGoogleSync(ctx.db, userId, a.id, "synced", id ?? null);
    return "synced";
  } catch (e) {
    console.error(JSON.stringify({ stage: "google-sync", kind: (e as Error).name, status: (e as GoogleError).status }));
    await setGoogleSync(ctx.db, userId, a.id, "failed");
    return "failed";
  }
}
