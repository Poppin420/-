import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "./helpers/testDb";
import { call, makeContext, signedIn, SIGNUP_CODE } from "./helpers/app";
import type { Db } from "../src/db/db";
import type { CardPreview } from "../src/actions/actions";

let db: Db;
beforeAll(async () => {
  db = await createTestDb();
});

const appt = (client: string, date: string, time: string, extra: Record<string, unknown> = {}) => ({
  actions: [{ type: "create_appointment", client_name: client, date_text: date, time_text: time, ...extra }],
});

/** Sends a command through /api/parse and returns the previews. */
async function command(t: ReturnType<typeof makeContext>, cookie: string, transcript: string, extraction: unknown) {
  t.willExtract(extraction);
  const res = await call(t.app, "POST", "/api/parse", { cookie, body: { text: transcript } });
  expect(res.status).toBe(200);
  return { transcript, previews: res.json.previews as CardPreview[] };
}

function execute(t: ReturnType<typeof makeContext>, cookie: string, transcript: string, p: CardPreview, choices = {}) {
  return call(t.app, "POST", "/api/actions/execute", {
    cookie,
    body: { card: { id: p.card.id, raw: p.card.raw, userProvided: p.card.userProvided }, transcript, choices },
  });
}

describe("authentication", () => {
  it("keeps signup closed without a configured code", async () => {
    const t = makeContext(db);
    t.ctx.config.signupCode = null;
    const res = await call(t.app, "POST", "/api/auth/signup", { body: { email: "a@b.gr", password: "x".repeat(12), signupCode: "" } });
    expect(res.status).toBe(403);
  });

  it("rejects a wrong signup code and weak passwords", async () => {
    const t = makeContext(db);
    expect((await call(t.app, "POST", "/api/auth/signup", { body: { email: "a@b.gr", password: "x".repeat(12), signupCode: "nope" } })).status).toBe(403);
    expect((await call(t.app, "POST", "/api/auth/signup", { body: { email: "a@b.gr", password: "short", signupCode: SIGNUP_CODE } })).status).toBe(400);
  });

  it("sets a hardened session cookie and rejects duplicate emails", async () => {
    const t = makeContext(db);
    const body = { email: "Dup@Example.gr", password: "correct horse battery", signupCode: SIGNUP_CODE };
    const res = await call(t.app, "POST", "/api/auth/signup", { body });
    expect(res.status).toBe(201);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^__Host-sid=[\w-]{40,};/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect((await call(t.app, "POST", "/api/auth/signup", { body: { ...body, email: "dup@example.gr" } })).status).toBe(409);
  });

  it("logs in, reports the user, and logs out", async () => {
    const t = makeContext(db);
    await call(t.app, "POST", "/api/auth/signup", { body: { email: "login@example.gr", password: "correct horse battery", signupCode: SIGNUP_CODE } });
    expect((await call(t.app, "POST", "/api/auth/login", { body: { email: "login@example.gr", password: "wrong password" } })).status).toBe(401);
    const res = await call(t.app, "POST", "/api/auth/login", { body: { email: "LOGIN@example.gr", password: "correct horse battery" } });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
    const me = await call(t.app, "GET", "/api/auth/me", { cookie });
    expect(me.json.user.email).toBe("login@example.gr");
    await call(t.app, "POST", "/api/auth/logout", { cookie });
    expect((await call(t.app, "GET", "/api/auth/me", { cookie })).status).toBe(401);
  });

  it("locks an account after repeated failures without revealing whether it exists", async () => {
    const t = makeContext(db);
    await call(t.app, "POST", "/api/auth/signup", { body: { email: "lock@example.gr", password: "correct horse battery", signupCode: SIGNUP_CODE } });
    for (let i = 0; i < 10; i++) {
      expect((await call(t.app, "POST", "/api/auth/login", { body: { email: "lock@example.gr", password: "bad" } })).status).toBe(401);
    }
    const locked = await call(t.app, "POST", "/api/auth/login", { body: { email: "lock@example.gr", password: "correct horse battery" } });
    expect(locked.status).toBe(429);
    const unknown = await call(t.app, "POST", "/api/auth/login", { body: { email: "nobody@example.gr", password: "bad" } });
    expect(unknown.status).toBe(401);
    expect(unknown.json.error).toBe("Λάθος email ή κωδικός.");
  });

  it("requires a session and rejects cross-origin writes", async () => {
    const t = makeContext(db);
    expect((await call(t.app, "GET", "/api/appointments?from=2026-10-21")).status).toBe(401);
    const cookie = await signedIn(t.app);
    const res = await call(t.app, "POST", "/api/parse", { cookie, body: { text: "x" }, origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});

describe("voice and parse", () => {
  it("transcribes, parses and previews", async () => {
    const t = makeContext(db);
    const cookie = await signedIn(t.app);
    t.willExtract(appt("Μαρία", "αύριο", "στις 5 το απόγευμα"), "Ραντεβού με τη Μαρία αύριο στις 5 το απόγευμα");
    const form = new FormData();
    form.append("audio", new Blob(["x"], { type: "audio/webm" }), "a.webm");
    const res = await call(t.app, "POST", "/api/voice", { cookie, form });
    expect(res.status).toBe(200);
    expect(res.json.transcript).toContain("Μαρία");
    expect(res.json.previews[0].card.fields.start).toBe("2026-10-22T17:00:00+03:00");
    expect(res.json.previews[0].context).toMatchObject({ blockers: [], clientChoice: { selected: "new", newName: "Μαρία" } });
  });

  it("does not leak details when transcription fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = makeContext(db, { transcribe: async () => Promise.reject(Object.assign(new Error("gsk_secret"), { status: 500 })) });
    const cookie = await signedIn(t.app);
    const form = new FormData();
    form.append("audio", new Blob(["x"]), "a.webm");
    const res = await call(t.app, "POST", "/api/voice", { cookie, form });
    expect(res.status).toBe(502);
    expect(res.text).not.toContain("gsk_secret");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("gsk_secret");
    spy.mockRestore();
  });

  it("returns the transcript when the LLM output is invalid", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = makeContext(db);
    const cookie = await signedIn(t.app);
    t.willExtract({ nope: true });
    const res = await call(t.app, "POST", "/api/parse", { cookie, body: { text: "κάτι μυστικό" } });
    expect(res.status).toBe(502);
    expect(res.json.transcript).toBe("κάτι μυστικό");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("μυστικό");
    spy.mockRestore();
  });

  it("returns 503 when voice is not configured", async () => {
    const t = makeContext(db, { llm: null, transcribe: null });
    const cookie = await signedIn(t.app);
    expect((await call(t.app, "POST", "/api/parse", { cookie, body: { text: "αύριο" } })).status).toBe(503);
  });
});

describe("appointments", () => {
  it("books an appointment, creates the client, and lists it", async () => {
    const t = makeContext(db);
    const cookie = await signedIn(t.app);
    const { transcript, previews } = await command(t, cookie, "Ραντεβού με τη Μαρία αύριο στις 5 το απόγευμα", appt("Μαρία", "αύριο", "στις 5 το απόγευμα"));
    const res = await execute(t, cookie, transcript, previews[0]!);
    expect(res.status).toBe(200);
    expect(res.json.appointment).toMatchObject({ client_name: "Μαρία", starts_at: "2026-10-22T17:00:00+03:00", ends_at: "2026-10-22T18:00:00+03:00" });
    const list = await call(t.app, "GET", "/api/appointments?from=2026-10-22&to=2026-10-22", { cookie });
    expect(list.json.appointments).toHaveLength(1);
    const clients = await call(t.app, "GET", "/api/clients", { cookie });
    expect(clients.json.clients.map((c: { name: string }) => c.name)).toEqual(["Μαρία"]);
  });

  it("blocks double booking at preview and at execution", async () => {
    const t = makeContext(db);
    const cookie = await signedIn(t.app);
    const first = await command(t, cookie, "Ραντεβού με τη Μαρία αύριο στις 5 το απόγευμα", appt("Μαρία", "αύριο", "στις 5 το απόγευμα"));
    expect((await execute(t, cookie, first.transcript, first.previews[0]!)).status).toBe(200);

    const second = await command(t, cookie, "Ραντεβού με τον Νίκο αύριο στις 5 και μισή το απόγευμα", appt("Νίκο", "αύριο", "στις 5 και μισή το απόγευμα"));
    expect(second.previews[0]!.context.blockers[0]).toContain("Συμπίπτει με άλλο ραντεβού: Μαρία");
    const res = await execute(t, cookie, second.transcript, second.previews[0]!);
    expect(res.status).toBe(409);
    expect((await call(t.app, "GET", "/api/appointments?from=2026-10-22", { cookie })).json.appointments).toHaveLength(1);
  });

  it("lets only one of two concurrent bookings for the same slot through", async () => {
    const t = makeContext(db);
    const cookie = await signedIn(t.app);
    const a = await command(t, cookie, "Ραντεβού με τη Μαρία μεθαύριο στις 10 το πρωί", appt("Μαρία", "μεθαύριο", "στις 10 το πρωί"));
    const b = await command(t, cookie, "Ραντεβού με τον Νίκο μεθαύριο στις 10 το πρωί", appt("Νίκο", "μεθαύριο", "στις 10 το πρωί"));
    const results = await Promise.all([execute(t, cookie, a.transcript, a.previews[0]!), execute(t, cookie, b.transcript, b.previews[0]!)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await call(t.app, "GET", "/api/appointments?from=2026-10-23", { cookie })).json.appointments).toHaveLength(1);
  });

  it("is idempotent per confirmed card", async () => {
    const t = makeContext(db);
    const cookie = await signedIn(t.app);
    const c = await command(t, cookie, "Ραντεβού με τη Μαρία αύριο στις 9 το πρωί", appt("Μαρία", "αύριο", "στις 9 το πρωί"));
    const r1 = await execute(t, cookie, c.transcript, c.previews[0]!);
    const r2 = await execute(t, cookie, c.transcript, c.previews[0]!);
    expect(r2.status).toBe(200);
    expect(r2.json.appointment.id).toBe(r1.json.appointment.id);
    expect((await call(t.app, "GET", "/api/clients", { cookie })).json.clients).toHaveLength(1);
  });

  it("refuses cards with open questions", async () => {
    const t = makeContext(db);
    const cookie = await signedIn(t.app);
    const c = await command(t, cookie, "Ραντεβού με τη Μαρία αύριο στις 5", appt("Μαρία", "αύριο", "στις 5"));
    expect((await execute(t, cookie, c.transcript, c.previews[0]!)).status).toBe(422);
  });

  it("applies answers on the server and re-checks", async () => {
    const t = makeContext(db);
    const cookie = await signedIn(t.app);
    const c = await command(t, cookie, "Ραντεβού με τη Μαρία αύριο στις 5", appt("Μαρία", "αύριο", "στις 5"));
    const p = c.previews[0]!;
    const res = await call(t.app, "POST", "/api/actions/preview", {
      cookie,
      body: { card: { id: p.card.id, raw: p.card.raw, userProvided: p.card.userProvided }, transcript: c.transcript, answer: { field: "time_text", value: "17:00" } },
    });
    expect(res.json.card.ready).toBe(true);
    expect(res.json.card.userProvided).toContain("time_text");
    expect((await execute(t, cookie, c.transcript, res.json)).status).toBe(200);
  });

  it("blocks times that already passed today", async () => {
    const t = makeContext(db);
    const cookie = await signedIn(t.app);
    const c = await command(t, cookie, "Ραντεβού με τη Μαρία σήμερα στις 9 το πρωί", appt("Μαρία", "σήμερα", "στις 9 το πρωί"));
    expect(c.previews[0]!.context.blockers).toContain("Η ώρα αυτή έχει ήδη περάσει.");
  });

  it("matches existing clients across Greek cases and asks when several match", async () => {
    const t = makeContext(db);
    const cookie = await signedIn(t.app);
    for (const name of ["Νίκος Αντωνίου", "Νίκος Παππάς", "Μαρία Παπαδοπούλου"]) {
      t.willExtract({ actions: [{ type: "create_client", client_name: name }] });
      const c = await command(t, cookie, `Νέος πελάτης ${name}`, { actions: [{ type: "create_client", client_name: name }] });
      expect((await execute(t, cookie, c.transcript, c.previews[0]!)).status).toBe(200);
    }
    const maria = await command(t, cookie, "Ραντεβού με τη Μαρίας αύριο στις 11 το πρωί", appt("Μαρίας", "αύριο", "στις 11 το πρωί"));
    const mChoice = maria.previews[0]!.context.clientChoice!;
    expect(mChoice.options.map((o) => o.label)).toEqual(["Μαρία Παπαδοπούλου"]);
    expect(mChoice.selected).toBe(mChoice.options[0]!.id);

    const nikos = await command(t, cookie, "Ραντεβού με τον Νίκο αύριο στις 12 το μεσημέρι", appt("Νίκο", "αύριο", "στις 12 το μεσημέρι"));
    const p = nikos.previews[0]!;
    expect(p.context.clientChoice!.options).toHaveLength(2);
    expect(p.context.blockers[0]).toContain("Βρέθηκαν 2 πελάτες");
    expect((await execute(t, cookie, nikos.transcript, p)).status).toBe(409);
    const chosen = p.context.clientChoice!.options[1]!;
    const res = await execute(t, cookie, nikos.transcript, p, { clientId: chosen.id });
    expect(res.status).toBe(200);
    expect(res.json.appointment.client_name).toBe(chosen.label);
  });

  it("reschedules keeping the duration, allowing overlap only with itself", async () => {
    const t = makeContext(db);
    const cookie = await signedIn(t.app);
    const c = await command(t, cookie, "Ραντεβού με τη Μαρία αύριο στις 5 το απόγευμα για ενάμιση ώρα", appt("Μαρία", "αύριο", "στις 5 το απόγευμα", { duration_text: "ενάμιση ώρα" }));
    await execute(t, cookie, c.transcript, c.previews[0]!);

    const r = await command(t, cookie, "Μετέφερε το ραντεβού της Μαρίας για αύριο στις 6 το απόγευμα", {
      actions: [{ type: "reschedule_appointment", client_name: "Μαρίας", new_date_text: "αύριο", new_time_text: "στις 6 το απόγευμα" }],
    });
    expect(r.previews[0]!.context.blockers).toEqual([]);
    const res = await execute(t, cookie, r.transcript, r.previews[0]!);
    expect(res.status).toBe(200);
    expect(res.json.appointment).toMatchObject({ starts_at: "2026-10-22T18:00:00+03:00", ends_at: "2026-10-22T19:30:00+03:00" });
  });

  it("cancels and frees the slot", async () => {
    const t = makeContext(db);
    const cookie = await signedIn(t.app);
    const c = await command(t, cookie, "Ραντεβού με τον Γιάννη αύριο στις 3 το απόγευμα", appt("Γιάννη", "αύριο", "στις 3 το απόγευμα"));
    await execute(t, cookie, c.transcript, c.previews[0]!);
    const x = await command(t, cookie, "Ακύρωσε το ραντεβού με τον Γιάννη αύριο", {
      actions: [{ type: "cancel_appointment", client_name: "Γιάννη", date_text: "αύριο" }],
    });
    expect(x.previews[0]!.context.appointmentChoice!.options[0]!.label).toContain("Γιάννη, Πεμ 22/10 15:00–16:00");
    expect((await execute(t, cookie, x.transcript, x.previews[0]!)).status).toBe(200);
    expect((await call(t.app, "GET", "/api/appointments?from=2026-10-22", { cookie })).json.appointments).toHaveLength(0);
    const again = await command(t, cookie, "Ραντεβού με τη Μαρία αύριο στις 3 το απόγευμα", appt("Μαρία", "αύριο", "στις 3 το απόγευμα"));
    expect(again.previews[0]!.context.blockers).toEqual([]);
  });

  it("reports when there is nothing to cancel", async () => {
    const t = makeContext(db);
    const cookie = await signedIn(t.app);
    const x = await command(t, cookie, "Ακύρωσε το ραντεβού με την Άννα", { actions: [{ type: "cancel_appointment", client_name: "Άννα" }] });
    expect(x.previews[0]!.context.blockers).toEqual(["Δεν βρέθηκε επερχόμενο ραντεβού που να ταιριάζει."]);
  });

  it("answers calendar queries with the agenda", async () => {
    const t = makeContext(db);
    const cookie = await signedIn(t.app);
    const c = await command(t, cookie, "Ραντεβού με τη Μαρία την Παρασκευή στις 10 το πρωί", appt("Μαρία", "την Παρασκευή", "στις 10 το πρωί"));
    await execute(t, cookie, c.transcript, c.previews[0]!);
    const q = await command(t, cookie, "Τι έχω αυτή την εβδομάδα;", { actions: [{ type: "query_calendar", date_text: "αυτή την εβδομάδα" }] });
    expect(q.previews[0]!.context.agenda!.map((a) => a.starts_at)).toEqual(["2026-10-23T10:00:00+03:00"]);
  });

  it("isolates users from each other", async () => {
    const t = makeContext(db);
    const alice = await signedIn(t.app);
    const bob = await signedIn(t.app);
    const c = await command(t, alice, "Ραντεβού με τη Μαρία αύριο στις 1 το μεσημέρι", appt("Μαρία", "αύριο", "στις 1 το μεσημέρι"));
    const booked = await execute(t, alice, c.transcript, c.previews[0]!);
    const id = booked.json.appointment.id;
    expect((await call(t.app, "GET", "/api/appointments?from=2026-10-22", { cookie: bob })).json.appointments).toHaveLength(0);
    expect((await call(t.app, "POST", `/api/appointments/${id}/cancel`, { cookie: bob })).status).toBe(404);
    const bobSame = await command(t, bob, "Ραντεβού με τη Μαρία αύριο στις 1 το μεσημέρι", appt("Μαρία", "αύριο", "στις 1 το μεσημέρι"));
    expect(bobSame.previews[0]!.context).toMatchObject({ blockers: [], clientChoice: { selected: "new" } });
    // Replaying Alice's card id as Bob must not return Alice's stored result.
    const replay = await execute(t, bob, c.transcript, c.previews[0]!);
    expect(replay.json.appointment?.id).not.toBe(id);
  });

  it("validates the date range of listings", async () => {
    const t = makeContext(db);
    const cookie = await signedIn(t.app);
    expect((await call(t.app, "GET", "/api/appointments?from=bad", { cookie })).status).toBe(400);
    expect((await call(t.app, "GET", "/api/appointments?from=2026-01-01&to=2026-12-31", { cookie })).status).toBe(400);
  });
});

describe("Google Calendar", () => {
  async function connect(t: ReturnType<typeof makeContext>, cookie: string) {
    const res = await call(t.app, "POST", "/api/google/connect", { cookie });
    const url = new URL(res.json.url);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/calendar.events");
    expect(url.searchParams.get("access_type")).toBe("offline");
    const state = url.searchParams.get("state")!;
    return call(t.app, "GET", `/api/google/callback?state=${encodeURIComponent(state)}&code=good-code`, { cookie });
  }

  it("connects with PKCE and stores only an encrypted refresh token", async () => {
    const t = makeContext(db);
    const cookie = await signedIn(t.app);
    const cb = await connect(t, cookie);
    expect(cb.status).toBe(303);
    expect(cb.headers.get("location")).toBe("/#/settings?google=connected");
    const exchange = t.google.calls.find((c) => c.body.includes("grant_type=authorization_code"))!;
    expect(exchange.body).toContain("code_verifier=");
    const rows = await db.query<{ refresh_token_enc: string }>("select refresh_token_enc from google_connections");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.refresh_token_enc).not.toContain("refresh-secret-1");
    expect((await call(t.app, "GET", "/api/auth/me", { cookie })).json.google).toEqual({ available: true, connected: true });
  });

  it("rejects a forged or reused state", async () => {
    const t = makeContext(db);
    const cookie = await signedIn(t.app);
    const forged = await call(t.app, "GET", "/api/google/callback?state=forged&code=good-code", { cookie });
    expect(forged.headers.get("location")).toBe("/#/settings?google=error");
    const other = await signedIn(t.app);
    const res = await call(t.app, "POST", "/api/google/connect", { cookie });
    const state = new URL(res.json.url).searchParams.get("state")!;
    // Another user's session cannot complete this user's OAuth flow.
    const stolen = await call(t.app, "GET", `/api/google/callback?state=${state}&code=good-code`, { cookie: other });
    expect(stolen.headers.get("location")).toBe("/#/settings?google=error");
  });

  it("mirrors create, move and cancel to Google, and warns about Google busy times", async () => {
    const t = makeContext(db);
    const cookie = await signedIn(t.app);
    await connect(t, cookie);
    const c = await command(t, cookie, "Ραντεβού με τη Μαρία αύριο στις 5 το απόγευμα", appt("Μαρία", "αύριο", "στις 5 το απόγευμα"));
    const booked = await execute(t, cookie, c.transcript, c.previews[0]!);
    expect(booked.json.appointment.google_sync_status).toBe("synced");
    expect([...t.google.events.values()][0]).toMatchObject({ summary: "Μαρία", start: { dateTime: "2026-10-22T17:00:00+03:00", timeZone: "Europe/Athens" } });

    t.google.busy = [{ start: "2026-10-22T19:00:00+03:00", end: "2026-10-22T20:00:00+03:00" }];
    const m = await command(t, cookie, "Μετέφερε το ραντεβού της Μαρίας για αύριο στις 7 το απόγευμα", {
      actions: [{ type: "reschedule_appointment", client_name: "Μαρίας", new_date_text: "αύριο", new_time_text: "στις 7 το απόγευμα" }],
    });
    expect(m.previews[0]!.context.blockers).toEqual([]);
    expect(m.previews[0]!.context.warnings).toEqual(["Στο Google Calendar είσαι απασχολημένος 19:00–20:00."]);
    await execute(t, cookie, m.transcript, m.previews[0]!);
    expect(t.google.events.get("evt-1")).toMatchObject({ start: { dateTime: "2026-10-22T19:00:00+03:00" } });

    const id = booked.json.appointment.id;
    await call(t.app, "POST", `/api/appointments/${id}/cancel`, { cookie });
    expect(t.google.events.size).toBe(0);
  });

  it("keeps the local appointment when Google fails, and retries", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = makeContext(db);
    const cookie = await signedIn(t.app);
    await connect(t, cookie);
    t.google.failWrites = true;
    const c = await command(t, cookie, "Ραντεβού με τη Μαρία αύριο στις 8 το πρωί", appt("Μαρία", "αύριο", "στις 8 το πρωί"));
    const booked = await execute(t, cookie, c.transcript, c.previews[0]!);
    expect(booked.status).toBe(200);
    expect(booked.json.appointment.google_sync_status).toBe("failed");
    t.google.failWrites = false;
    const retry = await call(t.app, "POST", `/api/appointments/${booked.json.appointment.id}/sync`, { cookie });
    expect(retry.json.appointment.google_sync_status).toBe("synced");
    spy.mockRestore();
  });

  it("disconnects and revokes", async () => {
    const t = makeContext(db);
    const cookie = await signedIn(t.app);
    await connect(t, cookie);
    await call(t.app, "POST", "/api/google/disconnect", { cookie });
    expect(t.google.calls.some((c) => c.url.startsWith("https://oauth2.googleapis.com/revoke"))).toBe(true);
    expect((await call(t.app, "GET", "/api/auth/me", { cookie })).json.google.connected).toBe(false);
  });
});

describe("GDPR", () => {
  it("exports the user's data without secrets", async () => {
    const t = makeContext(db);
    const cookie = await signedIn(t.app);
    const c = await command(t, cookie, "Ραντεβού με τη Μαρία αύριο στις 10 το πρωί", appt("Μαρία", "αύριο", "στις 10 το πρωί"));
    await execute(t, cookie, c.transcript, c.previews[0]!);
    const res = await call(t.app, "GET", "/api/account/export", { cookie });
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.json.clients).toHaveLength(1);
    expect(res.json.appointments).toHaveLength(1);
    expect(res.text).not.toContain("password_hash");
    expect(res.text).not.toContain("scrypt$");
  });

  it("deletes the account and everything in it after password confirmation", async () => {
    const t = makeContext(db);
    const cookie = await signedIn(t.app);
    const c = await command(t, cookie, "Ραντεβού με τη Μαρία αύριο στις 11 το πρωί", appt("Μαρία", "αύριο", "στις 11 το πρωί"));
    const booked = await execute(t, cookie, c.transcript, c.previews[0]!);
    expect((await call(t.app, "POST", "/api/account/delete", { cookie, body: { password: "wrong" } })).status).toBe(403);
    expect((await call(t.app, "POST", "/api/account/delete", { cookie, body: { password: "correct horse battery" } })).status).toBe(200);
    expect((await call(t.app, "GET", "/api/auth/me", { cookie })).status).toBe(401);
    const left = await db.query("select 1 from appointments where id = $1", [booked.json.appointment.id]);
    expect(left).toHaveLength(0);
  });
});
