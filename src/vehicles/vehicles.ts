import type { Db } from "../db/db";
import { isUuid } from "../clients/clients";

export interface Vehicle {
  id: string;
  client_id: string;
  plate: string;
  make: string | null;
  model: string | null;
  /** Engine size / type, e.g. "1600cc" or "diesel". */
  engine: string | null;
  vin: string | null;
  year: number | null;
  notes: string | null;
}

const COLUMNS = "id, client_id, plate, make, model, engine, vin, year, notes";

export interface VehicleInput {
  client_id: string;
  plate: string;
  make?: string | null;
  model?: string | null;
  engine?: string | null;
  vin?: string | null;
  year?: number | string | null;
  notes?: string | null;
}

export class VehicleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VehicleError";
  }
}

/** A plate reduced to its letters and digits, uppercased, so "αβγ-1234" == "ΑΒΓ 1234". */
export function normalizePlate(value: string): string {
  return value.toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function text(value: string | null | undefined, max: number, label: string): string | null {
  const v = value?.trim();
  if (!v) return null;
  if (v.length > max) throw new VehicleError(`${label} είναι πολύ μεγάλο.`);
  return v;
}

/** Validates and normalizes a vehicle's writable fields; throws VehicleError on bad input. */
function clean(data: VehicleInput): Omit<VehicleInput, "year"> & { plate: string; year: number | null } {
  const plate = data.plate?.trim().toUpperCase();
  if (!plate) throw new VehicleError("Η πινακίδα είναι υποχρεωτική.");
  if (plate.length > 20) throw new VehicleError("Η πινακίδα είναι πολύ μεγάλη.");
  let year: number | null = null;
  if (data.year != null && String(data.year).trim() !== "") {
    year = Math.trunc(Number(data.year));
    if (!Number.isFinite(year) || year < 1900 || year > 2100) throw new VehicleError("Το έτος δεν είναι έγκυρο.");
  }
  return {
    client_id: data.client_id,
    plate,
    make: text(data.make, 60, "Η μάρκα"),
    model: text(data.model, 60, "Το μοντέλο"),
    engine: text(data.engine, 40, "Ο κινητήρας"),
    vin: text(data.vin, 40, "Το VIN"),
    year,
    notes: text(data.notes, 2000, "Οι σημειώσεις"),
  };
}

async function clientExists(db: Db, userId: string, clientId: string): Promise<boolean> {
  if (!isUuid(clientId)) return false;
  const rows = await db.query("select 1 from clients where user_id = $1 and id = $2", [userId, clientId]);
  return rows.length > 0;
}

/** Vehicles of one client, oldest first. */
export async function listVehicles(db: Db, userId: string, clientId: string): Promise<Vehicle[]> {
  if (!isUuid(clientId)) return [];
  return db.query<Vehicle>(
    `select ${COLUMNS} from vehicles where user_id = $1 and client_id = $2 order by created_at`,
    [userId, clientId],
  );
}

export async function getVehicle(db: Db, userId: string, id: string): Promise<Vehicle | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.query<Vehicle>(`select ${COLUMNS} from vehicles where user_id = $1 and id = $2`, [userId, id]);
  return row ?? null;
}

/** Vehicles whose plate matches a spoken command, best first (exact plate before partial). */
export async function findVehiclesByPlate(db: Db, userId: string, spoken: string): Promise<Vehicle[]> {
  const needle = normalizePlate(spoken);
  if (needle.length < 2) return [];
  const rows = await db.query<Vehicle>(`select ${COLUMNS} from vehicles where user_id = $1`, [userId]);
  return rows
    .map((v) => ({ v, norm: normalizePlate(v.plate) }))
    .filter(({ norm }) => norm.length > 0 && (needle.includes(norm) || norm.includes(needle)))
    .sort((a, b) => Number(b.norm === needle) - Number(a.norm === needle))
    .map(({ v }) => v);
}

export async function createVehicle(db: Db, userId: string, data: VehicleInput): Promise<Vehicle> {
  const v = clean(data);
  if (!(await clientExists(db, userId, v.client_id))) throw new VehicleError("Ο πελάτης δεν βρέθηκε.");
  const [row] = await db.query<Vehicle>(
    `insert into vehicles (user_id, client_id, plate, make, model, engine, vin, year, notes)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning ${COLUMNS}`,
    [userId, v.client_id, v.plate, v.make, v.model, v.engine, v.vin, v.year, v.notes],
  );
  return row!;
}

/** Updates a vehicle's writable fields. Fields left undefined keep their value. The owning client never changes. */
export async function updateVehicle(db: Db, userId: string, id: string, data: Partial<VehicleInput>): Promise<Vehicle | null> {
  const current = await getVehicle(db, userId, id);
  if (!current) return null;
  const v = clean({
    client_id: current.client_id,
    plate: data.plate ?? current.plate,
    make: data.make !== undefined ? data.make : current.make,
    model: data.model !== undefined ? data.model : current.model,
    engine: data.engine !== undefined ? data.engine : current.engine,
    vin: data.vin !== undefined ? data.vin : current.vin,
    year: data.year !== undefined ? data.year : current.year,
    notes: data.notes !== undefined ? data.notes : current.notes,
  });
  const [row] = await db.query<Vehicle>(
    `update vehicles set plate = $3, make = $4, model = $5, engine = $6, vin = $7, year = $8, notes = $9, updated_at = now()
     where user_id = $1 and id = $2 returning ${COLUMNS}`,
    [userId, id, v.plate, v.make, v.model, v.engine, v.vin, v.year, v.notes],
  );
  return row ?? null;
}

export async function deleteVehicle(db: Db, userId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = await db.query(`delete from vehicles where user_id = $1 and id = $2 returning id`, [userId, id]);
  return rows.length > 0;
}
