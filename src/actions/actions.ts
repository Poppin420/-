import { DateTime } from "luxon";
import { z } from "zod";
import type { AppContext } from "../server/context";
import { RawAction } from "../intent-parsing/schema";
import { MAX_TRANSCRIPT_CHARS } from "../intent-parsing";
import { answerQuestion, resolveAction, type ActionCard } from "../intent-parsing/resolve";
import { createClient, getClient, isUuid, listClients, matchClients } from "../clients/clients";
import { findVehiclesByPlate } from "../vehicles/vehicles";
import {
  cancelAppointment,
  describeAppointment,
  findConflicts,
  findTargets,
  insertAppointment,
  listAppointments,
  moveAppointment,
  type Appointment,
} from "../calendar/appointments";
import { googleBusy, syncToGoogle } from "../calendar/google";
import { DbError, PG_EXCLUSION_VIOLATION, PG_UNIQUE_VIOLATION, type Db } from "../db/db";
import { loadProfile } from "../invoicing/profile";
import { insertDraft, planInvoice, type InvoicePlan } from "../invoicing/invoices";

export const NEW_CLIENT = "new";

export interface Choice {
  options: Array<{ id: string; label: string }>;
  selected: string | null;
}

/** Server-side facts about a card that the pure resolver cannot know. */
export interface ActionContext {
  /** Any blocker disables confirmation. */
  blockers: string[];
  warnings: string[];
  /** For new appointments: which client record to use ("new" creates one). */
  clientChoice?: Choice & { newName: string | null };
  /** For reschedule/cancel: which existing appointment. */
  appointmentChoice?: Choice;
  agenda?: Appointment[];
  /** For invoices: document type, VAT per line and the deterministic calculation. */
  invoice?: InvoicePlan;
}

export interface Choices {
  clientId?: string;
  appointmentId?: string;
  documentTypeId?: string;
  lineVatCategoryIds?: string[];
}

export interface CardPreview {
  card: ActionCard;
  context: ActionContext;
}

export const CardInput = z.object({
  card: z.object({
    id: z.string().uuid(),
    raw: RawAction,
    userProvided: z.array(z.string().max(100)).max(50).default([]),
  }),
  transcript: z.string().max(MAX_TRANSCRIPT_CHARS),
  answer: z.object({ field: z.string().max(100), value: z.string().max(500) }).optional(),
  choices: z
    .object({
      clientId: z.string().max(64).optional(),
      appointmentId: z.string().max(64).optional(),
      documentTypeId: z.string().max(40).optional(),
      lineVatCategoryIds: z.array(z.string().max(40)).max(50).optional(),
    })
    .default({}),
});
export type CardInput = z.infer<typeof CardInput>;

/** Rebuilds a card on the server from what the client sent, so nothing resolved in the browser is trusted. */
export function rebuildCard(input: CardInput, now: Date): ActionCard {
  const card = resolveAction(input.card.raw, input.transcript, now, input.card.userProvided, input.card.id);
  return input.answer ? answerQuestion(card, input.answer.field, input.answer.value, input.transcript, now) : card;
}

export async function previewCard(ctx: AppContext, userId: string, card: ActionCard, choices: Choices = {}): Promise<CardPreview> {
  const context: ActionContext = { blockers: [], warnings: [] };
  const f = card.fields;
  const now = ctx.now();

  switch (f.type) {
    case "create_appointment": {
      if (f.client_name) await chooseClient(ctx, userId, f.client_name, choices, context);
      if (f.start && f.duration_minutes) {
        const start = new Date(f.start);
        const end = new Date(start.getTime() + f.duration_minutes * 60_000);
        await checkSlot(ctx, userId, context, start, end, null, now);
      }
      break;
    }
    case "reschedule_appointment":
    case "cancel_appointment": {
      const criteria =
        f.type === "reschedule_appointment"
          ? { clientName: f.client_name, date: f.original_date, time: f.original_time }
          : { clientName: f.client_name, date: f.date, time: f.time };
      if (!criteria.clientName && !criteria.date) break;
      const targets = await findTargets(ctx.db, userId, now, criteria);
      const options = targets.map((a) => ({ id: a.id, label: describeAppointment(a) }));
      const selected =
        choices.appointmentId && options.some((o) => o.id === choices.appointmentId)
          ? choices.appointmentId
          : targets.length === 1
            ? targets[0]!.id
            : null;
      context.appointmentChoice = { options, selected };
      if (targets.length === 0) context.blockers.push("Δεν βρέθηκε επερχόμενο ραντεβού που να ταιριάζει.");
      else if (selected === null) context.blockers.push("Βρέθηκαν περισσότερα ραντεβού. Διάλεξε ποιο εννοείς.");

      if (f.type === "reschedule_appointment" && selected && f.new_start) {
        const target = targets.find((a) => a.id === selected)!;
        const duration = new Date(target.ends_at).getTime() - new Date(target.starts_at).getTime();
        const start = new Date(f.new_start);
        await checkSlot(ctx, userId, context, start, new Date(start.getTime() + duration), target.id, now);
      }
      break;
    }
    case "query_calendar":
      if (f.start && f.end) context.agenda = await listAppointments(ctx.db, userId, f.start, f.end);
      break;
    case "create_client":
      if (f.client_name) {
        const existing = matchClients(f.client_name, await listClients(ctx.db, userId));
        if (existing.length > 0) {
          context.warnings.push(`Υπάρχει ήδη πελάτης με παρόμοιο όνομα: ${existing.slice(0, 3).map((c) => `«${c.name}»`).join(", ")}.`);
        }
      }
      break;
    case "create_invoice": {
      const clients = f.client_name ? await chooseClient(ctx, userId, f.client_name, choices, context) : [];
      const selected = context.clientChoice?.selected;
      const client = selected && selected !== NEW_CLIENT ? (clients.find((c) => c.id === selected) ?? null) : null;
      const profile = await loadProfile(ctx.db, userId);
      context.invoice = planInvoice(
        f,
        profile,
        { client, newName: selected === NEW_CLIENT ? f.client_name : null },
        choices,
        context.blockers,
        context.warnings,
      );
      if (card.ready && context.blockers.length === 0 && !context.invoice.draft) {
        context.blockers.push("Δεν μπορεί να συνταχθεί προσχέδιο με τα τρέχοντα στοιχεία.");
      }
      break;
    }
  }
  return { card, context };
}

/** Resolves the spoken name to an existing client, a new one, or asks when several match. */
async function chooseClient(ctx: AppContext, userId: string, name: string, choices: Choices, context: ActionContext) {
  const clients = await listClients(ctx.db, userId);
  const matches = matchClients(name, clients);
  // A spoken licence plate should find the owner through any of their cars, not
  // just the plate stored on the client record. Only when the text looks like a
  // plate (has a digit) so that ordinary names are left to the name matcher.
  if (/\d/.test(name)) {
    const byId = new Map(clients.map((c) => [c.id, c]));
    const alreadyMatched = new Set(matches.map((c) => c.id));
    const ownersByPlate = (await findVehiclesByPlate(ctx.db, userId, name))
      .map((v) => byId.get(v.client_id))
      .filter((c): c is NonNullable<typeof c> => !!c && !alreadyMatched.has(c.id));
    // Plate hits are specific, so put them first.
    matches.unshift(...new Map(ownersByPlate.map((c) => [c.id, c])).values());
  }
  const options = matches.map((c) => ({ id: c.id, label: c.vat_number ? `${c.name} (ΑΦΜ ${c.vat_number})` : c.name }));
  const selected =
    choices.clientId && (choices.clientId === NEW_CLIENT || options.some((o) => o.id === choices.clientId))
      ? choices.clientId
      : matches.length === 1
        ? matches[0]!.id
        : matches.length === 0
          ? NEW_CLIENT
          : null;
  context.clientChoice = { options, selected, newName: name };
  if (selected === null) context.blockers.push(`Βρέθηκαν ${matches.length} πελάτες για «${name}». Διάλεξε ποιος είναι.`);
  return matches;
}

/** Double-booking and past-time checks for a proposed slot. Internal overlaps block; Google ones warn. */
async function checkSlot(
  ctx: AppContext,
  userId: string,
  context: ActionContext,
  start: Date,
  end: Date,
  ignoreId: string | null,
  now: Date,
): Promise<void> {
  if (start < now) context.blockers.push("Η ώρα αυτή έχει ήδη περάσει.");
  for (const c of await findConflicts(ctx.db, userId, start, end, ignoreId)) {
    context.blockers.push(`Συμπίπτει με άλλο ραντεβού: ${describeAppointment(c)}.`);
  }
  try {
    for (const b of (await googleBusy(ctx, userId, start, end)) ?? []) {
      const s = DateTime.fromISO(b.start, { setZone: true }).toFormat("HH:mm");
      const e = DateTime.fromISO(b.end, { setZone: true }).toFormat("HH:mm");
      context.warnings.push(`Στο Google Calendar είσαι απασχολημένος ${s}–${e}.`);
    }
  } catch {
    context.warnings.push("Δεν ήταν δυνατός ο έλεγχος του Google Calendar.");
  }
}

export type ExecuteOutcome =
  | { kind: "done"; result: ExecutionResult }
  | { kind: "not_ready"; preview: CardPreview }
  | { kind: "blocked"; preview: CardPreview }
  | { kind: "conflict"; message: string; preview: CardPreview };

export interface ExecutionResult {
  message: string;
  appointment?: Appointment;
  client?: { id: string; name: string };
  invoiceId?: string;
}

/**
 * Executes a confirmed card. The card is rebuilt and re-checked on the server,
 * writes happen in one transaction together with an idempotency record keyed
 * by the card id, and the database exclusion constraint is the final guard
 * against double booking.
 */
export async function executeCard(ctx: AppContext, userId: string, input: CardInput): Promise<ExecuteOutcome> {
  const card = rebuildCard({ ...input, answer: undefined }, ctx.now());
  const stored = await storedResult(ctx.db, userId, card.id);
  if (stored) return { kind: "done", result: stored };

  const preview = await previewCard(ctx, userId, card, input.choices);
  if (!card.ready) return { kind: "not_ready", preview };
  if (preview.context.blockers.length > 0) return { kind: "blocked", preview };

  let result: ExecutionResult;
  try {
    result = await ctx.db.transaction(async (tx) => {
      const r = await applyCard(tx, userId, card, preview.context);
      await tx.query("insert into executed_actions (user_id, card_id, result) values ($1, $2, $3)", [
        userId,
        card.id,
        JSON.stringify(r),
      ]);
      return r;
    });
  } catch (e) {
    if (e instanceof DbError && e.code === PG_EXCLUSION_VIOLATION) {
      return { kind: "conflict", message: "Το διάστημα μόλις κλείστηκε από άλλο ραντεβού. Δες ξανά το ημερολόγιο.", preview };
    }
    if (e instanceof DbError && e.code === PG_UNIQUE_VIOLATION && e.constraint === "executed_actions_pkey") {
      const again = await storedResult(ctx.db, userId, card.id);
      if (again) return { kind: "done", result: again };
    }
    throw e;
  }

  if (result.appointment) {
    result.appointment.google_sync_status = await syncToGoogle(ctx, userId, result.appointment);
  }
  return { kind: "done", result };
}

async function applyCard(tx: Db, userId: string, card: ActionCard, context: ActionContext): Promise<ExecutionResult> {
  const f = card.fields;
  switch (f.type) {
    case "create_appointment": {
      const choice = context.clientChoice?.selected ?? NEW_CLIENT;
      let client: { id: string; name: string } | null = null;
      if (choice === NEW_CLIENT) {
        client = await createClient(tx, userId, { name: f.client_name! });
      } else {
        client = await getClient(tx, userId, choice);
        if (!client) throw new Error("selected client not found");
      }
      const start = new Date(f.start!);
      const end = new Date(start.getTime() + f.duration_minutes! * 60_000);
      const appointment = await insertAppointment(tx, userId, {
        clientId: client.id,
        clientName: client.name,
        title: f.title,
        start,
        end,
      });
      return { message: `Κλείστηκε: ${describeAppointment(appointment)}.`, appointment, client };
    }
    case "reschedule_appointment": {
      const target = context.appointmentChoice!.selected!;
      const [current] = await tx.query<{ starts_at: Date; ends_at: Date }>(
        "select starts_at, ends_at from appointments where user_id = $1 and id = $2 and status = 'scheduled' for update",
        [userId, target],
      );
      if (!current) throw new Error("appointment not found");
      const duration = new Date(current.ends_at).getTime() - new Date(current.starts_at).getTime();
      const start = new Date(f.new_start!);
      const moved = await moveAppointment(tx, userId, target, start, new Date(start.getTime() + duration));
      if (!moved) throw new Error("appointment not found");
      return { message: `Μετακινήθηκε: ${describeAppointment(moved)}.`, appointment: moved };
    }
    case "cancel_appointment": {
      const cancelled = await cancelAppointment(tx, userId, context.appointmentChoice!.selected!);
      if (!cancelled) throw new Error("appointment not found");
      return { message: `Ακυρώθηκε: ${describeAppointment(cancelled)}.`, appointment: cancelled };
    }
    case "create_client": {
      const client = await createClient(tx, userId, {
        name: f.client_name!,
        vat_number: f.vat_number,
        phone: f.phone,
        email: f.email,
      });
      return { message: `Προστέθηκε ο πελάτης «${client.name}».`, client };
    }
    case "query_calendar":
      return { message: "Εμφανίστηκε το πρόγραμμα." };
    case "create_invoice": {
      const draft = structuredClone(context.invoice!.draft!);
      if (context.clientChoice?.selected === NEW_CLIENT) {
        const client = await createClient(tx, userId, { name: draft.customer.name });
        draft.customer.client_id = client.id;
      }
      const invoice = await insertDraft(tx, userId, draft);
      return {
        message: "Αποθηκεύτηκε προσχέδιο. Η έκδοση γίνεται από την καρτέλα «Παραστατικά» με το κουμπί «Έκδοση».",
        invoiceId: invoice.id,
      };
    }
  }
}

async function storedResult(db: Db, userId: string, cardId: string): Promise<ExecutionResult | null> {
  if (!isUuid(cardId)) return null;
  const [row] = await db.query<{ result: ExecutionResult | string }>(
    "select result from executed_actions where user_id = $1 and card_id = $2",
    [userId, cardId],
  );
  if (!row) return null;
  return typeof row.result === "string" ? (JSON.parse(row.result) as ExecutionResult) : row.result;
}
