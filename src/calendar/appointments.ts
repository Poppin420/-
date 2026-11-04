import { DateTime } from "luxon";
import type { Db } from "../db/db";
import { ZONE } from "../intent-parsing/greekDate";
import { isUuid, matchClients, type Client } from "../clients/clients";

export interface Appointment {
  id: string;
  client_id: string | null;
  client_name: string;
  title: string | null;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "cancelled";
  google_event_id: string | null;
  google_sync_status: "none" | "synced" | "failed";
}

interface Row extends Omit<Appointment, "starts_at" | "ends_at"> {
  starts_at: Date | string;
  ends_at: Date | string;
}

const COLUMNS = "id, client_id, client_name, title, starts_at, ends_at, status, google_event_id, google_sync_status";

/** Rows come back as Date objects; the API speaks ISO strings with the Athens offset. */
function toAppointment(r: Row): Appointment {
  return { ...r, starts_at: athensIso(r.starts_at), ends_at: athensIso(r.ends_at) };
}

export function athensIso(value: Date | string): string {
  const d = value instanceof Date ? DateTime.fromJSDate(value) : DateTime.fromISO(value);
  return d.setZone(ZONE).toISO({ suppressMilliseconds: true })!;
}

/** Day range [from 00:00, to+1 00:00) in Athens, as UTC instants. */
export function athensDayRange(from: string, to: string): { start: Date; end: Date } {
  return {
    start: DateTime.fromISO(from, { zone: ZONE }).startOf("day").toJSDate(),
    end: DateTime.fromISO(to, { zone: ZONE }).plus({ days: 1 }).startOf("day").toJSDate(),
  };
}

export async function listAppointments(db: Db, userId: string, from: string, to: string): Promise<Appointment[]> {
  const { start, end } = athensDayRange(from, to);
  const rows = await db.query<Row>(
    `select ${COLUMNS} from appointments
     where user_id = $1 and status = 'scheduled' and starts_at < $3 and ends_at > $2
     order by starts_at`,
    [userId, start, end],
  );
  return rows.map(toAppointment);
}

export async function getAppointment(db: Db, userId: string, id: string): Promise<Appointment | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.query<Row>(`select ${COLUMNS} from appointments where user_id = $1 and id = $2`, [userId, id]);
  return row ? toAppointment(row) : null;
}

/** Scheduled appointments overlapping [start, end), optionally ignoring one (when rescheduling it). */
export async function findConflicts(
  db: Db,
  userId: string,
  start: Date,
  end: Date,
  ignoreId: string | null = null,
): Promise<Appointment[]> {
  const rows = await db.query<Row>(
    `select ${COLUMNS} from appointments
     where user_id = $1 and status = 'scheduled' and starts_at < $3 and ends_at > $2
       and ($4::uuid is null or id <> $4::uuid)
     order by starts_at`,
    [userId, start, end, ignoreId],
  );
  return rows.map(toAppointment);
}

/**
 * Upcoming scheduled appointments that fit a spoken description ("το ραντεβού
 * της Μαρίας αύριο"), used to pick the target of a reschedule or cancel.
 */
export async function findTargets(
  db: Db,
  userId: string,
  now: Date,
  criteria: { clientName: string | null; date: string | null; time: string | null },
): Promise<Appointment[]> {
  const from = criteria.date
    ? athensDayRange(criteria.date, criteria.date)
    : { start: now, end: DateTime.fromJSDate(now).plus({ years: 1 }).toJSDate() };
  const rows = (
    await db.query<Row>(
      `select ${COLUMNS} from appointments
       where user_id = $1 and status = 'scheduled' and ends_at > $2 and starts_at < $3
       order by starts_at limit 200`,
      [userId, from.start, from.end],
    )
  ).map(toAppointment);

  return rows.filter((a) => {
    if (criteria.time && DateTime.fromISO(a.starts_at, { setZone: true }).toFormat("HH:mm") !== criteria.time) return false;
    if (criteria.clientName) {
      const asClient: Client = { id: a.id, name: a.client_name, nickname: null, plate: null, vat_number: null, phone: null, email: null };
      if (matchClients(criteria.clientName, [asClient]).length === 0) return false;
    }
    return true;
  });
}

export async function insertAppointment(
  db: Db,
  userId: string,
  data: { clientId: string | null; clientName: string; title: string | null; start: Date; end: Date },
): Promise<Appointment> {
  const [row] = await db.query<Row>(
    `insert into appointments (user_id, client_id, client_name, title, starts_at, ends_at)
     values ($1, $2, $3, $4, $5, $6) returning ${COLUMNS}`,
    [userId, data.clientId, data.clientName, data.title, data.start, data.end],
  );
  return toAppointment(row!);
}

export async function moveAppointment(db: Db, userId: string, id: string, start: Date, end: Date): Promise<Appointment | null> {
  const [row] = await db.query<Row>(
    `update appointments set starts_at = $3, ends_at = $4, updated_at = now()
     where user_id = $1 and id = $2 and status = 'scheduled' returning ${COLUMNS}`,
    [userId, id, start, end],
  );
  return row ? toAppointment(row) : null;
}

export async function cancelAppointment(db: Db, userId: string, id: string): Promise<Appointment | null> {
  const [row] = await db.query<Row>(
    `update appointments set status = 'cancelled', updated_at = now()
     where user_id = $1 and id = $2 and status = 'scheduled' returning ${COLUMNS}`,
    [userId, id],
  );
  return row ? toAppointment(row) : null;
}

export async function setGoogleSync(
  db: Db,
  userId: string,
  id: string,
  status: Appointment["google_sync_status"],
  eventId?: string | null,
): Promise<void> {
  await db.query(
    `update appointments set google_sync_status = $3, google_event_id = coalesce($4, google_event_id)
     where user_id = $1 and id = $2`,
    [userId, id, status, eventId ?? null],
  );
}

export function describeAppointment(a: Pick<Appointment, "client_name" | "starts_at" | "ends_at">): string {
  const s = DateTime.fromISO(a.starts_at, { setZone: true });
  const e = DateTime.fromISO(a.ends_at, { setZone: true });
  const days = ["", "Δευ", "Τρι", "Τετ", "Πεμ", "Παρ", "Σαβ", "Κυρ"];
  return `${a.client_name}, ${days[s.weekday]} ${s.toFormat("d/M")} ${s.toFormat("HH:mm")}–${e.toFormat("HH:mm")}`;
}
