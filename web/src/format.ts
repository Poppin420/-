import { DateTime } from "luxon";

export const ZONE = "Europe/Athens";
const WEEKDAYS = ["", "Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο", "Κυριακή"];
const MONTHS = ["", "Ιαν", "Φεβ", "Μαρ", "Απρ", "Μαΐ", "Ιουν", "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"];

export function time(iso: string): string {
  return DateTime.fromISO(iso, { setZone: true }).setZone(ZONE).toFormat("HH:mm");
}

export function dayTitle(isoDate: string): string {
  const d = DateTime.fromISO(isoDate, { zone: ZONE });
  return `${WEEKDAYS[d.weekday]} ${d.day} ${MONTHS[d.month]}`;
}

export function todayIso(): string {
  return DateTime.now().setZone(ZONE).toISODate()!;
}

export function addDays(isoDate: string, days: number): string {
  return DateTime.fromISO(isoDate, { zone: ZONE }).plus({ days }).toISODate()!;
}

export function weekStart(isoDate: string): string {
  return DateTime.fromISO(isoDate, { zone: ZONE }).startOf("week").toISODate()!;
}

export function dateOf(iso: string): string {
  return DateTime.fromISO(iso, { setZone: true }).setZone(ZONE).toISODate()!;
}
