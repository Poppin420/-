import type { Db } from "../db/db";
import { isUuid } from "../clients/clients";

export interface ServiceItem {
  id: string;
  label: string;
  category: string | null;
  position: number;
  active: boolean;
}

const COLUMNS = "id, label, category, position, active";

/**
 * The default checklist a Greek car workshop starts with. Seeded once per user,
 * then fully editable (add, rename, reorder, hide). Grouped by category so the
 * UI can show sections.
 */
export const DEFAULT_SERVICE_ITEMS: Array<{ label: string; category: string }> = [
  { label: "Αλλαγή λαδιών", category: "Λάδια & φίλτρα" },
  { label: "Φίλτρο λαδιού", category: "Λάδια & φίλτρα" },
  { label: "Φίλτρο αέρος", category: "Λάδια & φίλτρα" },
  { label: "Φίλτρο βενζίνης / πετρελαίου", category: "Λάδια & φίλτρα" },
  { label: "Φίλτρο καμπίνας", category: "Λάδια & φίλτρα" },
  { label: "Μπουζί", category: "Ανάφλεξη" },
  { label: "Πλατίνες", category: "Ανάφλεξη" },
  { label: "Ρύθμιση ρελαντί", category: "Ρυθμίσεις" },
  { label: "Ρύθμιση βαλβίδων", category: "Ρυθμίσεις" },
  { label: "Βαλβολίνη σασμάν", category: "Μετάδοση" },
  { label: "Βαλβολίνη διαφορικού", category: "Μετάδοση" },
  { label: "Ιμάντας χρονισμού", category: "Ιμάντες" },
  { label: "Ιμάντας δυναμό", category: "Ιμάντες" },
  { label: "Ιμάντας A/C", category: "Ιμάντες" },
  { label: "Ιμάντας τιμονιού", category: "Ιμάντες" },
  { label: "Ρουλεμάν", category: "Ιμάντες" },
  { label: "Μπροστινό σύστημα", category: "Ανάρτηση / φρένα" },
  { label: "Φρένα εμπρός", category: "Ανάρτηση / φρένα" },
  { label: "Φρένα πίσω", category: "Ανάρτηση / φρένα" },
  { label: "Σύστημα ψύξης", category: "Ψύξη" },
];

/** Lists a user's service items (optionally only active ones), seeding defaults on first use. */
export async function listServiceItems(db: Db, userId: string, opts: { activeOnly?: boolean } = {}): Promise<ServiceItem[]> {
  const existing = await db.query<ServiceItem>(`select ${COLUMNS} from service_items where user_id = $1 order by position, label`, [userId]);
  const rows = existing.length === 0 ? await seedDefaults(db, userId) : existing;
  return opts.activeOnly ? rows.filter((r) => r.active) : rows;
}

async function seedDefaults(db: Db, userId: string): Promise<ServiceItem[]> {
  return db.transaction(async (tx) => {
    // Another concurrent request may have seeded already; re-check inside the tx.
    const again = await tx.query<ServiceItem>(`select ${COLUMNS} from service_items where user_id = $1 order by position, label`, [userId]);
    if (again.length > 0) return again;
    const out: ServiceItem[] = [];
    for (let i = 0; i < DEFAULT_SERVICE_ITEMS.length; i++) {
      const d = DEFAULT_SERVICE_ITEMS[i]!;
      const [row] = await tx.query<ServiceItem>(
        `insert into service_items (user_id, label, category, position) values ($1, $2, $3, $4) returning ${COLUMNS}`,
        [userId, d.label, d.category, i],
      );
      out.push(row!);
    }
    return out;
  });
}

export class ServiceItemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceItemError";
  }
}

export interface ServiceItemInput {
  label: string;
  category?: string | null;
  position?: number | null;
  active?: boolean | null;
}

function cleanLabel(label: string | undefined): string {
  const v = label?.trim();
  if (!v) throw new ServiceItemError("Η ονομασία της εργασίας είναι υποχρεωτική.");
  if (v.length > 80) throw new ServiceItemError("Η ονομασία είναι πολύ μεγάλη.");
  return v;
}

export async function createServiceItem(db: Db, userId: string, data: ServiceItemInput): Promise<ServiceItem> {
  const label = cleanLabel(data.label);
  const category = data.category?.trim() || null;
  if (category && category.length > 60) throw new ServiceItemError("Η κατηγορία είναι πολύ μεγάλη.");
  // New items go to the end by default.
  const [{ next } = { next: 0 }] = await db.query<{ next: number }>(
    "select coalesce(max(position), -1) + 1 as next from service_items where user_id = $1",
    [userId],
  );
  const [row] = await db.query<ServiceItem>(
    `insert into service_items (user_id, label, category, position) values ($1, $2, $3, $4) returning ${COLUMNS}`,
    [userId, label, category, data.position ?? next],
  );
  return row!;
}

export async function updateServiceItem(db: Db, userId: string, id: string, data: Partial<ServiceItemInput>): Promise<ServiceItem | null> {
  if (!isUuid(id)) return null;
  const [current] = await db.query<ServiceItem>(`select ${COLUMNS} from service_items where user_id = $1 and id = $2`, [userId, id]);
  if (!current) return null;
  const label = data.label !== undefined ? cleanLabel(data.label) : current.label;
  const category = data.category !== undefined ? data.category?.trim() || null : current.category;
  if (category && category.length > 60) throw new ServiceItemError("Η κατηγορία είναι πολύ μεγάλη.");
  const position = data.position != null ? Math.trunc(data.position) : current.position;
  const active = data.active != null ? data.active : current.active;
  const [row] = await db.query<ServiceItem>(
    `update service_items set label = $3, category = $4, position = $5, active = $6 where user_id = $1 and id = $2 returning ${COLUMNS}`,
    [userId, id, label, category, position, active],
  );
  return row ?? null;
}

export async function deleteServiceItem(db: Db, userId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = await db.query(`delete from service_items where user_id = $1 and id = $2 returning id`, [userId, id]);
  return rows.length > 0;
}
