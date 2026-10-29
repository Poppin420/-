import type { Db } from "../db/db";
import { normalizeGreek, tokenize } from "../intent-parsing/greekText";

export interface Client {
  id: string;
  name: string;
  /** User-set nickname ("Γιώργος σίδερα"), for voice matching only. Never sent to AADE. */
  nickname: string | null;
  /** Vehicle licence plate, for a car workshop to find a client by car. Never sent to AADE. */
  plate: string | null;
  vat_number: string | null;
  phone: string | null;
  email: string | null;
}

const COLUMNS = "id, name, nickname, plate, vat_number, phone, email";

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

/** Stems a client can be recognized by: its official name and its nickname. */
function clientStems(c: Client): string[] {
  return [...new Set([...nameStems(c.name), ...(c.nickname ? nameStems(c.nickname) : [])])];
}

/**
 * Clients whose name or nickname contains every stem of the spoken name, best
 * first: "Μαρία" matches "Μαρία Παπαδοπούλου"; "Γιώργος σίδερα" matches the
 * client named "Γιώργος Παπαδόπουλος" with that nickname.
 */
export function matchClients(spoken: string, clients: Client[]): Client[] {
  const wanted = nameStems(spoken);
  if (wanted.length === 0) return [];
  return clients
    .map((c) => ({ c, stems: clientStems(c) }))
    .filter(({ stems }) => wanted.every((w) => stems.includes(w)))
    .sort((a, b) => a.stems.length - b.stems.length)
    .map(({ c }) => c);
}

export async function listClients(db: Db, userId: string): Promise<Client[]> {
  return db.query<Client>(`select ${COLUMNS} from clients where user_id = $1 order by name limit 5000`, [userId]);
}

export async function getClient(db: Db, userId: string, id: string): Promise<Client | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.query<Client>(`select ${COLUMNS} from clients where user_id = $1 and id = $2`, [userId, id]);
  return row ?? null;
}

export interface ClientInput {
  name: string;
  nickname?: string | null;
  plate?: string | null;
  vat_number?: string | null;
  phone?: string | null;
  email?: string | null;
}

export class ClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientError";
  }
}

/** Validates and normalizes the writable fields; throws ClientError on bad input. */
function clean(data: ClientInput): Required<Omit<ClientInput, "name">> & { name: string } {
  const name = data.name.trim();
  if (!name) throw new ClientError("Το όνομα του πελάτη είναι υποχρεωτικό.");
  const nickname = data.nickname?.trim() || null;
  if (nickname && nickname.length > 80) throw new ClientError("Το ψευδώνυμο είναι πολύ μεγάλο.");
  const plate = data.plate?.trim().toUpperCase() || null;
  if (plate && plate.length > 20) throw new ClientError("Η πινακίδα είναι πολύ μεγάλη.");
  const vat_number = data.vat_number?.trim() || null;
  if (vat_number && !/^[0-9]{9}$/.test(vat_number)) throw new ClientError("Ο ΑΦΜ πρέπει να έχει 9 ψηφία.");
  return { name, nickname, plate, vat_number, phone: data.phone?.trim() || null, email: data.email?.trim() || null };
}

export async function createClient(db: Db, userId: string, data: ClientInput): Promise<Client> {
  const c = clean(data);
  const [row] = await db.query<Client>(
    `insert into clients (user_id, name, nickname, plate, vat_number, phone, email) values ($1, $2, $3, $4, $5, $6, $7)
     returning ${COLUMNS}`,
    [userId, c.name, c.nickname, c.plate, c.vat_number, c.phone, c.email],
  );
  return row!;
}

/** Updates a client's writable fields. Fields left undefined keep their value. */
export async function updateClient(db: Db, userId: string, id: string, data: Partial<ClientInput>): Promise<Client | null> {
  const current = await getClient(db, userId, id);
  if (!current) return null;
  const c = clean({
    name: data.name ?? current.name,
    nickname: data.nickname !== undefined ? data.nickname : current.nickname,
    plate: data.plate !== undefined ? data.plate : current.plate,
    vat_number: data.vat_number !== undefined ? data.vat_number : current.vat_number,
    phone: data.phone !== undefined ? data.phone : current.phone,
    email: data.email !== undefined ? data.email : current.email,
  });
  const [row] = await db.query<Client>(
    `update clients set name = $3, nickname = $4, plate = $5, vat_number = $6, phone = $7, email = $8
     where user_id = $1 and id = $2 returning ${COLUMNS}`,
    [userId, id, c.name, c.nickname, c.plate, c.vat_number, c.phone, c.email],
  );
  return row ?? null;
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
