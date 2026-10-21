import type { Db } from "./db";

/**
 * Schema migrations, applied in order and recorded in schema_migrations.
 * Kept as TypeScript strings so they bundle into serverless functions.
 * Never edit an applied migration; add a new one.
 */
export const MIGRATIONS: Array<{ id: string; sql: string }> = [
  {
    id: "001_users_clients_calendar",
    sql: `
create extension if not exists btree_gist;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);
create unique index users_email_key on users (lower(email));

create table sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user_idx on sessions (user_id);

create table login_attempts (
  key text not null,
  attempted_at timestamptz not null default now()
);
create index login_attempts_key_idx on login_attempts (key, attempted_at);

create table clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null check (length(name) between 1 and 200),
  vat_number text check (vat_number ~ '^[0-9]{9}$'),
  phone text,
  email text,
  created_at timestamptz not null default now()
);
create index clients_user_idx on clients (user_id);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  client_name text not null,
  title text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  google_event_id text,
  google_sync_status text not null default 'none' check (google_sync_status in ('none', 'synced', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  -- Final guard against double booking, even under concurrent requests.
  constraint appointments_no_overlap exclude using gist (
    user_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'scheduled')
);
create index appointments_user_start_idx on appointments (user_id, starts_at);

-- One row per confirmed card: replays of the same confirmation return the stored result.
create table executed_actions (
  user_id uuid not null references users(id) on delete cascade,
  card_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, card_id)
);

create table google_connections (
  user_id uuid primary key references users(id) on delete cascade,
  refresh_token_enc text not null,
  calendar_id text not null default 'primary',
  created_at timestamptz not null default now()
);

create table oauth_states (
  state_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  code_verifier_enc text not null,
  expires_at timestamptz not null
);
`,
  },
];

export async function runMigrations(db: Db): Promise<string[]> {
  await db.query(
    "create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())",
  );
  const done = new Set((await db.query<{ id: string }>("select id from schema_migrations")).map((r) => r.id));
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.transaction(async (tx) => {
      for (const statement of splitStatements(m.sql)) await tx.query(statement);
      await tx.query("insert into schema_migrations (id) values ($1)", [m.id]);
    });
    applied.push(m.id);
  }
  return applied;
}

/** Splits on semicolons at line ends; migrations avoid functions/DO blocks so this stays simple. */
function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter((s) => s.length > 0);
}
