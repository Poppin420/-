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
  {
    id: "002_invoicing",
    sql: `
create table business_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- myDATA credentials per user and environment, encrypted with the app's secret box.
create table aade_credentials (
  user_id uuid not null references users(id) on delete cascade,
  environment text not null check (environment in ('test', 'prod')),
  username_enc text not null,
  subscription_key_enc text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, environment)
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'sending', 'issued', 'rejected', 'unknown', 'cancelled')),
  environment text not null default 'test' check (environment in ('test', 'prod')),
  document_type_id text not null,
  series text,
  number integer check (number > 0),
  issue_date date,
  -- One key per document: a document can be submitted at most once.
  idempotency_key uuid not null unique default gen_random_uuid(),
  draft jsonb not null,
  request_xml text,
  response_body text,
  mark text,
  uid text,
  aade_error jsonb,
  cancellation jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  issued_at timestamptz
);
create index invoices_user_idx on invoices (user_id, created_at desc);
-- No duplicate numbers among documents that reached (or may have reached) AADE.
create unique index invoices_number_key on invoices (user_id, environment, document_type_id, series, number)
  where status in ('sending', 'issued', 'unknown', 'cancelled');

-- Issued documents are immutable; the only allowed change is cancellation.
-- Anything that reached AADE can never be deleted (this also blocks account deletion).
create function protect_invoices() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('sending', 'issued', 'unknown', 'cancelled') then
      raise exception 'invoice % reached AADE and cannot be deleted', old.id;
    end if;
    return old;
  end if;
  if old.status in ('issued', 'cancelled') then
    if (to_jsonb(new) - 'status' - 'cancellation' - 'updated_at') is distinct from
       (to_jsonb(old) - 'status' - 'cancellation' - 'updated_at')
       or not (new.status = old.status or (old.status = 'issued' and new.status = 'cancelled')) then
      raise exception 'invoice % is issued and immutable', old.id;
    end if;
  end if;
  if old.status <> 'draft' and new.draft is distinct from old.draft then
    raise exception 'invoice % is no longer a draft', old.id;
  end if;
  if old.request_xml is not null and new.request_xml is distinct from old.request_xml then
    raise exception 'submitted XML of invoice % is immutable', old.id;
  end if;
  return new;
end
$$;

create trigger invoices_protect before update or delete on invoices
  for each row execute function protect_invoices();
`,
  },
  {
    id: "003_client_nickname",
    sql: `
-- Per-user nickname for a client ("Γιώργος σίδερα"): used for voice matching,
-- never sent to AADE (the official name/VAT is used there).
alter table clients add column nickname text check (nickname is null or length(nickname) between 1 and 80);
`,
  },
  {
    id: "004_client_plate",
    sql: `
-- Vehicle licence plate, for a car workshop to find a client by car. Never sent to AADE.
alter table clients add column plate text check (plate is null or length(plate) between 1 and 20);
`,
  },
  {
    id: "005_vehicles",
    sql: `
-- Vehicles owned by a client. A car workshop keeps several cars per client and
-- finds them by plate. Local workshop data only, never sent to AADE.
create table vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  plate text not null check (length(plate) between 1 and 20),
  make text check (make is null or length(make) between 1 and 60),
  model text check (model is null or length(model) between 1 and 60),
  engine text check (engine is null or length(engine) between 1 and 40),
  vin text check (vin is null or length(vin) between 1 and 40),
  year integer check (year is null or year between 1900 and 2100),
  notes text check (notes is null or length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index vehicles_user_client_idx on vehicles (user_id, client_id);
create index vehicles_user_plate_idx on vehicles (user_id, plate);
`,
  },
  {
    id: "006_service_items",
    sql: `
-- The workshop's configurable checklist of service tasks (oil change, filters,
-- belts, brakes ...). Seeded per user with a Greek default set on first use,
-- then freely editable. "position" orders them; "active" hides one without
-- losing history that referenced its label.
create table service_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  label text not null check (length(label) between 1 and 80),
  category text check (category is null or length(category) between 1 and 60),
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index service_items_user_idx on service_items (user_id, position);
`,
  },
  {
    id: "007_service_records",
    sql: `
-- Service history per vehicle: one row per visit, with the odometer reading,
-- the type of work, and the checklist labels that were done that day.
create table service_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  serviced_on date not null,
  odometer integer check (odometer is null or odometer between 0 and 10000000),
  work_type text check (work_type is null or length(work_type) <= 200),
  items jsonb not null default '[]'::jsonb,
  notes text check (notes is null or length(notes) <= 4000),
  created_at timestamptz not null default now()
);
create index service_records_user_vehicle_idx on service_records (user_id, vehicle_id, serviced_on desc);
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

/** Splits on semicolons outside quotes and $$-bodies; drops line comments. */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inDollar = false;
  let inQuote = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (!inQuote && !inDollar && ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      current += "\n";
      continue;
    }
    if (!inQuote && ch === "$" && sql[i + 1] === "$") {
      inDollar = !inDollar;
      current += "$$";
      i++;
      continue;
    }
    if (!inDollar && ch === "'") inQuote = !inQuote;
    if (!inQuote && !inDollar && ch === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}
