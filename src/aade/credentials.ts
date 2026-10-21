import type { AppContext } from "../server/context";

export type AadeEnvironment = "test" | "prod";

const PURPOSE_USER = "mydata-username";
const PURPOSE_KEY = "mydata-subscription-key";

export interface AadeCredentials {
  username: string;
  subscriptionKey: string;
}

export interface CredentialStatus {
  configured: boolean;
  /** Only a masked hint is ever sent back to the browser. */
  usernameHint: string | null;
  updatedAt: string | null;
}

export class CredentialsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialsError";
  }
}

/**
 * Per-user myDATA credentials, one set per environment, encrypted with
 * AES-256-GCM and bound to the user and purpose. They are never logged,
 * never returned in full and never sent to the LLM.
 */
export async function saveCredentials(ctx: AppContext, userId: string, env: AadeEnvironment, creds: AadeCredentials): Promise<void> {
  const box = ctx.config.secretBox;
  if (!box) throw new CredentialsError("encryption key is not configured");
  const username = creds.username.trim();
  const key = creds.subscriptionKey.trim();
  if (!/^[\x21-\x7e]{1,100}$/.test(username) || !/^[\x21-\x7e]{8,200}$/.test(key)) {
    throw new CredentialsError("invalid credentials format");
  }
  await ctx.db.query(
    `insert into aade_credentials (user_id, environment, username_enc, subscription_key_enc, updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (user_id, environment) do update
       set username_enc = excluded.username_enc, subscription_key_enc = excluded.subscription_key_enc, updated_at = now()`,
    [userId, env, box.seal(username, userId, `${PURPOSE_USER}:${env}`), box.seal(key, userId, `${PURPOSE_KEY}:${env}`)],
  );
}

export async function loadCredentials(ctx: AppContext, userId: string, env: AadeEnvironment): Promise<AadeCredentials | null> {
  const box = ctx.config.secretBox;
  if (!box) return null;
  const [row] = await ctx.db.query<{ username_enc: string; subscription_key_enc: string }>(
    "select username_enc, subscription_key_enc from aade_credentials where user_id = $1 and environment = $2",
    [userId, env],
  );
  if (!row) return null;
  return {
    username: box.open(row.username_enc, userId, `${PURPOSE_USER}:${env}`),
    subscriptionKey: box.open(row.subscription_key_enc, userId, `${PURPOSE_KEY}:${env}`),
  };
}

export async function credentialStatus(ctx: AppContext, userId: string): Promise<Record<AadeEnvironment, CredentialStatus>> {
  const result: Record<AadeEnvironment, CredentialStatus> = {
    test: { configured: false, usernameHint: null, updatedAt: null },
    prod: { configured: false, usernameHint: null, updatedAt: null },
  };
  for (const env of ["test", "prod"] as const) {
    const creds = await loadCredentials(ctx, userId, env).catch(() => null);
    if (!creds) continue;
    const [row] = await ctx.db.query<{ updated_at: Date }>(
      "select updated_at from aade_credentials where user_id = $1 and environment = $2",
      [userId, env],
    );
    result[env] = { configured: true, usernameHint: mask(creds.username), updatedAt: row ? new Date(row.updated_at).toISOString() : null };
  }
  return result;
}

export async function deleteCredentials(ctx: AppContext, userId: string, env: AadeEnvironment): Promise<void> {
  await ctx.db.query("delete from aade_credentials where user_id = $1 and environment = $2", [userId, env]);
}

function mask(username: string): string {
  return username.length <= 2 ? "**" : `${username.slice(0, 2)}${"*".repeat(Math.min(6, username.length - 2))}`;
}
