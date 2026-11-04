import type { Db } from "../db/db";
import { isUuid } from "../clients/clients";

export interface ServiceRecord {
  id: string;
  vehicle_id: string;
  serviced_on: string;
  odometer: number | null;
  work_type: string | null;
  /** Labels of the checklist items done at this visit (free strings, not ids). */
  items: string[];
  notes: string | null;
}

const COLUMNS = "id, vehicle_id, serviced_on, odometer, work_type, items, notes";

export class ServiceRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceRecordError";
  }
}

export interface ServiceRecordInput {
  serviced_on?: string | null;
  odometer?: number | string | null;
  work_type?: string | null;
  items?: unknown;
  notes?: string | null;
}

/** Validates and normalizes a service record's fields; throws on bad input. */
function clean(data: ServiceRecordInput): { serviced_on: string; odometer: number | null; work_type: string | null; items: string[]; notes: string | null } {
  // The driver may hand dates back as Date objects; reduce to a plain YYYY-MM-DD.
  const raw = data.serviced_on as unknown;
  const serviced_on = (raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw ?? "")).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviced_on) || Number.isNaN(Date.parse(serviced_on))) {
    throw new ServiceRecordError("Η ημερομηνία δεν είναι έγκυρη.");
  }
  let odometer: number | null = null;
  if (data.odometer != null && String(data.odometer).trim() !== "") {
    odometer = Math.trunc(Number(data.odometer));
    if (!Number.isFinite(odometer) || odometer < 0 || odometer > 10_000_000) throw new ServiceRecordError("Τα χιλιόμετρα δεν είναι έγκυρα.");
  }
  const work_type = data.work_type?.trim() || null;
  if (work_type && work_type.length > 200) throw new ServiceRecordError("Το είδος εργασίας είναι πολύ μεγάλο.");
  const items = Array.isArray(data.items)
    ? [...new Set(data.items.map((i) => String(i).trim()).filter((i) => i.length > 0 && i.length <= 80))]
    : [];
  const notes = data.notes?.trim() || null;
  if (notes && notes.length > 4000) throw new ServiceRecordError("Οι σημειώσεις είναι πολύ μεγάλες.");
  return { serviced_on, odometer, work_type, items, notes };
}

/** The driver may return a date column as a Date; present it as a plain YYYY-MM-DD string. */
function normalizeRow(row: ServiceRecord): ServiceRecord {
  const d = row.serviced_on as unknown;
  return { ...row, serviced_on: d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10) };
}

async function ownsVehicle(db: Db, userId: string, vehicleId: string): Promise<boolean> {
  if (!isUuid(vehicleId)) return false;
  const rows = await db.query("select 1 from vehicles where user_id = $1 and id = $2", [userId, vehicleId]);
  return rows.length > 0;
}

/** Service history of one vehicle, newest first. */
export async function listServiceRecords(db: Db, userId: string, vehicleId: string): Promise<ServiceRecord[]> {
  if (!isUuid(vehicleId)) return [];
  const rows = await db.query<ServiceRecord>(
    `select ${COLUMNS} from service_records where user_id = $1 and vehicle_id = $2 order by serviced_on desc, created_at desc`,
    [userId, vehicleId],
  );
  return rows.map(normalizeRow);
}

export async function createServiceRecord(db: Db, userId: string, vehicleId: string, data: ServiceRecordInput): Promise<ServiceRecord> {
  if (!(await ownsVehicle(db, userId, vehicleId))) throw new ServiceRecordError("Το όχημα δεν βρέθηκε.");
  const v = clean(data);
  const [row] = await db.query<ServiceRecord>(
    `insert into service_records (user_id, vehicle_id, serviced_on, odometer, work_type, items, notes)
     values ($1, $2, $3, $4, $5, $6, $7) returning ${COLUMNS}`,
    [userId, vehicleId, v.serviced_on, v.odometer, v.work_type, JSON.stringify(v.items), v.notes],
  );
  return normalizeRow(row!);
}

export async function updateServiceRecord(db: Db, userId: string, id: string, data: ServiceRecordInput): Promise<ServiceRecord | null> {
  if (!isUuid(id)) return null;
  const [current] = await db.query<ServiceRecord>(`select ${COLUMNS} from service_records where user_id = $1 and id = $2`, [userId, id]);
  if (!current) return null;
  const v = clean({
    serviced_on: data.serviced_on ?? current.serviced_on,
    odometer: data.odometer !== undefined ? data.odometer : current.odometer,
    work_type: data.work_type !== undefined ? data.work_type : current.work_type,
    items: data.items !== undefined ? data.items : current.items,
    notes: data.notes !== undefined ? data.notes : current.notes,
  });
  const [row] = await db.query<ServiceRecord>(
    `update service_records set serviced_on = $3, odometer = $4, work_type = $5, items = $6, notes = $7
     where user_id = $1 and id = $2 returning ${COLUMNS}`,
    [userId, id, v.serviced_on, v.odometer, v.work_type, JSON.stringify(v.items), v.notes],
  );
  return row ? normalizeRow(row) : null;
}

export async function deleteServiceRecord(db: Db, userId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = await db.query(`delete from service_records where user_id = $1 and id = $2 returning id`, [userId, id]);
  return rows.length > 0;
}
