import { z } from "zod";

/**
 * Raw output contract for the LLM. Every *_text field must be copied verbatim
 * from the transcript (or be null); deterministic code turns those spans into
 * dates, times and amounts. The LLM never computes anything.
 */
const span = z.string().trim().min(1).nullable().default(null);

export const RawInvoiceLine = z.object({
  description: span,
  quantity_text: span,
  amount_text: span,
});

export const RawAction = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_appointment"),
    client_name: span,
    date_text: span,
    time_text: span,
    duration_text: span,
    title: span,
  }),
  z.object({
    type: z.literal("reschedule_appointment"),
    client_name: span,
    original_date_text: span,
    original_time_text: span,
    new_date_text: span,
    new_time_text: span,
  }),
  z.object({
    type: z.literal("cancel_appointment"),
    client_name: span,
    date_text: span,
    time_text: span,
  }),
  z.object({
    type: z.literal("query_calendar"),
    date_text: span,
  }),
  z.object({
    type: z.literal("create_invoice"),
    client_name: span,
    lines: z.array(RawInvoiceLine).default([]),
    price_basis_text: span,
  }),
  z.object({
    type: z.literal("create_client"),
    client_name: span,
    vat_number_text: span,
    phone_text: span,
    email_text: span,
  }),
]);

export const RawExtraction = z.object({
  actions: z.array(RawAction).max(10),
  unrecognized: z.array(z.string()).default([]),
});

export type RawAction = z.infer<typeof RawAction>;
export type RawInvoiceLine = z.infer<typeof RawInvoiceLine>;
export type RawExtraction = z.infer<typeof RawExtraction>;
export type ActionType = RawAction["type"];
