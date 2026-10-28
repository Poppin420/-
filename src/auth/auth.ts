import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AppContext } from "../server/context";
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "../security/password";
import { PG_UNIQUE_VIOLATION, DbError } from "../db/db";

export const SESSION_COOKIE = "sid";
export const SESSION_DAYS = 30;
const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MINUTES = 15;

export interface SessionUser {
  id: string;
  email: string;
}

export type AuthResult = { ok: true; userId: string } | { ok: false; status: number; message: string };

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

export async function signup(ctx: AppContext, email: string, password: string, code: string): Promise<AuthResult> {
  const expected = ctx.config.signupCode;
  if (!expected) return { ok: false, status: 403, message: "Οι εγγραφές είναι κλειστές." };
  if (!constantTimeEqual(code, expected)) return { ok: false, status: 403, message: "Λάθος κωδικός εγγραφής." };
  const normalized = email.trim().toLowerCase();
  if (!EMAIL.test(normalized)) return { ok: false, status: 400, message: "Μη έγκυρο email." };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, status: 400, message: `Ο κωδικός πρέπει να έχει τουλάχιστον ${MIN_PASSWORD_LENGTH} χαρακτήρες.` };
  }
  const hash = await hashPassword(password, ctx.config.scryptLogN);
  try {
    const [row] = await ctx.db.query<{ id: string }>(
      "insert into users (email, password_hash) values ($1, $2) returning id",
      [normalized, hash],
    );
    return { ok: true, userId: row!.id };
  } catch (e) {
    if (e instanceof DbError && e.code === PG_UNIQUE_VIOLATION) {
      return { ok: false, status: 409, message: "Υπάρχει ήδη λογαριασμός με αυτό το email." };
    }
    throw e;
  }
}

export async function login(ctx: AppContext, email: string, password: string): Promise<AuthResult> {
  const key = email.trim().toLowerCase();
  const since = new Date(ctx.now().getTime() - LOCKOUT_MINUTES * 60_000);
  const [{ count } = { count: 0 }] = await ctx.db.query<{ count: number }>(
    "select count(*)::int as count from login_attempts where key = $1 and attempted_at > $2",
    [key, since],
  );
  if (count >= MAX_FAILED_LOGINS) {
    return { ok: false, status: 429, message: `Πολλές αποτυχημένες προσπάθειες. Δοκίμασε ξανά σε ${LOCKOUT_MINUTES} λεπτά.` };
  }

  const [user] = await ctx.db.query<{ id: string; password_hash: string }>(
    "select id, password_hash from users where lower(email) = $1",
    [key],
  );
  // Verify against a throwaway hash when the user does not exist so timing does not reveal accounts.
  const valid = user
    ? await verifyPassword(password, user.password_hash)
    : (await verifyPassword(password, await dummyHash(ctx.config.scryptLogN)), false);

  if (!user || !valid) {
    await ctx.db.query("insert into login_attempts (key, attempted_at) values ($1, $2)", [key, ctx.now()]);
    return { ok: false, status: 401, message: "Λάθος email ή κωδικός." };
  }
  await ctx.db.query("delete from login_attempts where key = $1 or attempted_at < $2", [key, since]);
  return { ok: true, userId: user.id };
}

let dummy: { logN: number; hash: Promise<string> } | null = null;
function dummyHash(logN: number): Promise<string> {
  if (!dummy || dummy.logN !== logN) dummy = { logN, hash: hashPassword(randomBytes(16).toString("hex"), logN) };
  return dummy.hash;
}

/** Creates a session and returns the raw token; only its SHA-256 is stored. */
export async function createSession(ctx: AppContext, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(ctx.now().getTime() + SESSION_DAYS * 86_400_000);
  await ctx.db.query("delete from sessions where user_id = $1 and expires_at < $2", [userId, ctx.now()]);
  await ctx.db.query("insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)", [
    sha256(token),
    userId,
    expires,
  ]);
  return token;
}

export async function authenticate(ctx: AppContext, req: Request): Promise<SessionUser | null> {
  const token = readCookie(req, cookieName(ctx));
  if (!token) return null;
  const [row] = await ctx.db.query<SessionUser>(
    `select u.id, u.email from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > $2`,
    [sha256(token), ctx.now()],
  );
  return row ?? null;
}

export async function destroySession(ctx: AppContext, req: Request): Promise<void> {
  const token = readCookie(req, cookieName(ctx));
  if (token) await ctx.db.query("delete from sessions where token_hash = $1", [sha256(token)]);
}

/** "__Host-" prefix forces Secure, Path=/ and no Domain in browsers; dropped on plain-http localhost. */
export function cookieName(ctx: AppContext): string {
  return ctx.config.secureCookies ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE;
}

export function sessionCookie(ctx: AppContext, token: string): string {
  const secure = ctx.config.secureCookies ? "; Secure" : "";
  return `${cookieName(ctx)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}

export function clearSessionCookie(ctx: AppContext): string {
  const secure = ctx.config.secureCookies ? "; Secure" : "";
  return `${cookieName(ctx)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || null;
  }
  return null;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function constantTimeEqual(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(sha256(a), "hex"), Buffer.from(sha256(b), "hex"));
}
