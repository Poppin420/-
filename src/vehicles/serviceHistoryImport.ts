import type { Db } from "../db/db";
import { normalizePlate } from "./vehicles";

/**
 * One historical service record from the workshop's old system, matched to a
 * vehicle by its plate. Local data only; nothing is sent to AADE.
 */
export interface ServiceHistoryRow {
  plate: string;
  serviced_on?: string | null;
  odometer?: string | number | null;
  work_type?: string | null;
  /** Checklist labels, as an array or a ";"-separated string. */
  items?: unknown;
  notes?: string | null;
}

export interface ServiceHistorySummary {
  created: number;
  skippedNoVehicle: number;
}

function text(v: unknown, max: number): string | null {
  const s = v == null ? "" : String(v).trim();
  return s ? s.slice(0, max) : null;
}

function isoDate(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
}

function odometer(v: unknown): number | null {
  if (v == null || String(v).trim() === "") return null;
  const n = Math.trunc(Number(String(v).replace(/[^0-9]/g, "")));
  return Number.isFinite(n) && n >= 0 && n <= 10_000_000 ? n : null;
}

function itemList(v: unknown): string[] {
  const arr = Array.isArray(v) ? v.map((x) => String(x)) : String(v ?? "").split(";");
  return [...new Set(arr.map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 80))].slice(0, 100);
}

/**
 * Imports historical service records, matching each to a vehicle by plate. Runs
 * in one transaction. Rows whose plate is not on file are skipped and counted.
 */
export async function importServiceHistory(db: Db, userId: string, rows: ServiceHistoryRow[]): Promise<ServiceHistorySummary> {
  return db.transaction(async (tx) => {
    const vehicles = await tx.query<{ id: string; plate: string }>("select id, plate from vehicles where user_id = $1", [userId]);
    const byPlate = new Map<string, string>();
    for (const v of vehicles) {
      const key = normalizePlate(v.plate);
      if (key && !byPlate.has(key)) byPlate.set(key, v.id);
    }

    const summary: ServiceHistorySummary = { created: 0, skippedNoVehicle: 0 };
    for (const row of rows) {
      const vehicleId = byPlate.get(normalizePlate(String(row.plate ?? "")));
      if (!vehicleId) {
        summary.skippedNoVehicle++;
        continue;
      }
      await tx.query(
        `insert into service_records (user_id, vehicle_id, serviced_on, odometer, work_type, items, notes)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [userId, vehicleId, isoDate(row.serviced_on), odometer(row.odometer), text(row.work_type, 200), JSON.stringify(itemList(row.items)), text(row.notes, 4000)],
      );
      summary.created++;
    }
    return summary;
  });
}
