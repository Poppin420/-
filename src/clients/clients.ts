import type { Db } from "../db/db";
import { normalizeGreek, tokenize } from "../intent-parsing/greekText";

export interface Client {
  id: string;
  name: string;
  vat_number: string | null;
  phone: string | null;
  email: string | null;
}

const TITLES = new Set(["κ", "κοσ", "κα", "κυριοσ", "κυριο", "κυριου", "κυρια", "κυριασ", "δρ", "δοκτωρ", "τον", "την", "τη", "του", "τησ", "ο", "η"]);
// Greek case endings, longest first. Stripping them lets "Μαρίας" match "Μαρία" and "Νίκο" match "Νίκος".
const ENDINGS = ["ουσ", "ων", "οσ", "ου", "ον", "εσ", "ησ", "ασ", "ισ", "α", "η", "ο", "ε", "ι", "σ"];

/** Case-insensitive, accent-insensitive stems of a person or company name. */
export function nameStems(name: string): string[] {
  return tokenize(normalizeGreek(name.replace(/\./g, " ")))
    .filter((t) => !TITLES.has(t))
    .map((t) => {
      if (!/\p{Script=Greek}/u.test(t)) return t;
      const ending = ENDINGS.find((e) => t.endsWith(e) && t.length - e.length >= 2);
      return ending ? t.slice(0, -ending.length) : t;
    });
}

/**
 * Clients whose name contains every stem of the spoken name, best first:
 * "Μαρία" matches "Μαρία Παπαδοπούλου"; "Νίκου" matches "Νίκος".
 */
export function matchClients(spoken: string, clients: Client[]): Client[] {
  const wanted = nameStems(spoken);
  if (wanted.length === 0) return [];
  return clients
    .map((c) => ({ c, stems: nameStems(c.name) }))
    .filter(({ stems }) => wanted.every((w) => stems.includes(w)))
    .sort((a, b) => a.stems.length - b.stems.length)
    .map(({ c }) => c);
}

export async function listClients(db: Db, userId: string): Promise<Client[]> {
  return db.query<Client>(
    "select id, name, vat_number, phone, email from clients where user_id = $1 order by name limit 5000",
    [userId],
  );
}

export async function getClient(db: Db, userId: string, id: string): Promise<Client | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.query<Client>(
    "select id, name, vat_number, phone, email from clients where user_id = $1 and id = $2",
    [userId, id],
  );
  return row ?? null;
}

export async function createClient(
  db: Db,
  userId: string,
  data: { name: string; vat_number?: string | null; phone?: string | null; email?: string | null },
): Promise<Client> {
  const [row] = await db.query<Client>(
    `insert into clients (user_id, name, vat_number, phone, email) values ($1, $2, $3, $4, $5)
     returning id, name, vat_number, phone, email`,
    [userId, data.name.trim(), data.vat_number ?? null, data.phone ?? null, data.email ?? null],
  );
  return row!;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
