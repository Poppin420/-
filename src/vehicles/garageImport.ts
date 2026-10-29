import type { Db } from "../db/db";
import { normalizeGreek } from "../intent-parsing/greekText";
import { normalizePlate } from "./vehicles";

/**
 * One imported row from the workshop's existing records (e.g. a Microsoft Access
 * export): one row is one car, carrying both the owner's details and the car's.
 * Importing only populates local clients and vehicles — nothing is ever sent to
 * AADE.
 */
export interface ImportRow {
  name?: string;
  nickname?: string;
  vat_number?: string;
  phone?: string;
  email?: string;
  plate?: string;
  make?: string;
  model?: string;
  engine?: string;
  vin?: string;
  year?: string;
  notes?: string;
}

export interface ImportSummary {
  clientsCreated: number;
  clientsMatched: number;
  vehiclesCreated: number;
  vehiclesSkipped: number;
  rowsSkipped: number;
}

const s = (v: string | undefined, max: number): string | null => {
  const t = v?.trim();
  return t ? t.slice(0, max) : null;
};

/** A client dedup key: normalized name plus VAT (VAT distinguishes namesakes). */
function clientKey(name: string, vat: string | null): string {
  return `${normalizeGreek(name).replace(/\s+/g, " ").trim()}|${vat ?? ""}`;
}

function parseYear(v: string | undefined): number | null {
  const n = Math.trunc(Number((v ?? "").trim()));
  return Number.isFinite(n) && n >= 1900 && n <= 2100 ? n : null;
}

/**
 * Imports rows into clients and vehicles, de-duplicating as it goes: rows with
 * the same owner collapse onto one client, and a car already on file (same
 * plate for that client) is not added twice. Runs in a single transaction.
 */
export async function importGarage(db: Db, userId: string, rows: ImportRow[]): Promise<ImportSummary> {
  const summary: ImportSummary = { clientsCreated: 0, clientsMatched: 0, vehiclesCreated: 0, vehiclesSkipped: 0, rowsSkipped: 0 };

  return db.transaction(async (tx) => {
    // Load existing clients and vehicle plates once, to match against.
    const existingClients = await tx.query<{ id: string; name: string; vat_number: string | null }>(
      "select id, name, vat_number from clients where user_id = $1",
      [userId],
    );
    const clientByKey = new Map<string, string>();
    for (const c of existingClients) clientByKey.set(clientKey(c.name, c.vat_number), c.id);

    const platesByClient = new Map<string, Set<string>>();
    const existingVehicles = await tx.query<{ client_id: string; plate: string }>(
      "select client_id, plate from vehicles where user_id = $1",
      [userId],
    );
    for (const v of existingVehicles) {
      const set = platesByClient.get(v.client_id) ?? new Set();
      set.add(normalizePlate(v.plate));
      platesByClient.set(v.client_id, set);
    }

    for (const row of rows) {
      const name = s(row.name, 200);
      const plate = row.plate?.trim().toUpperCase().slice(0, 20) || null;
      // A row with neither an owner name nor a plate carries nothing to import.
      if (!name && !plate) {
        summary.rowsSkipped++;
        continue;
      }

      const vat = /^[0-9]{9}$/.test((row.vat_number ?? "").trim()) ? row.vat_number!.trim() : null;
      // Without a name we cannot create a client; attach the car to a placeholder owner named by its plate.
      const effectiveName = name ?? `Όχημα ${plate}`;
      const key = clientKey(effectiveName, vat);

      let clientId = clientByKey.get(key);
      if (!clientId) {
        const [created] = await tx.query<{ id: string }>(
          `insert into clients (user_id, name, nickname, vat_number, phone, email, plate)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [userId, effectiveName, s(row.nickname, 80), vat, s(row.phone, 60), s(row.email, 120), plate],
        );
        clientId = created!.id;
        clientByKey.set(key, clientId);
        summary.clientsCreated++;
      } else {
        summary.clientsMatched++;
      }

      if (!plate) continue;
      const plates = platesByClient.get(clientId) ?? new Set<string>();
      if (plates.has(normalizePlate(plate))) {
        summary.vehiclesSkipped++;
        continue;
      }
      await tx.query(
        `insert into vehicles (user_id, client_id, plate, make, model, engine, vin, year, notes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [userId, clientId, plate, s(row.make, 60), s(row.model, 60), s(row.engine, 40), s(row.vin, 40), parseYear(row.year), s(row.notes, 2000)],
      );
      plates.add(normalizePlate(plate));
      platesByClient.set(clientId, plates);
      summary.vehiclesCreated++;
    }

    return summary;
  });
}
