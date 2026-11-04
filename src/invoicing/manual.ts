import type { Db } from "../db/db";
import { getClient } from "../clients/clients";
import { loadProfile } from "./profile";
import { insertDraft, planInvoice, type InvoicePlan, type InvoiceRow } from "./invoices";

/**
 * A receipt/invoice created from a plain form instead of a parsed phrase. The
 * amounts, VAT and document type are decided by the same deterministic planner
 * the rest of the app uses, so nothing here depends on the language model.
 */
export interface ManualInvoiceInput {
  client_id: string;
  description: string;
  /** A non-negative decimal string with a dot, e.g. "80" or "80.50". */
  amount: string;
  quantity?: string;
  price_basis: "with_vat" | "without_vat";
  documentTypeId?: string;
  lineVatCategoryId?: string;
}

export interface ManualInvoiceResult {
  plan: InvoicePlan;
  invoice: InvoiceRow | null;
  blockers: string[];
  warnings: string[];
}

export class ManualInvoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManualInvoiceError";
  }
}

/** Turns a Greek-typed money string ("80,50 €") into the planner's "80.50". */
export function normalizeAmount(value: string): string {
  return value.trim().replace(/[€\s]/g, "").replace(",", ".");
}

/**
 * Builds (and, when nothing is left to decide, saves) a one-line invoice draft
 * for an existing client. Returns the plan either way: when the business profile
 * needs a choice (document type, VAT category) or is incomplete, the caller shows
 * the options/blockers and submits again with them resolved. Returns null when
 * the client does not belong to the user.
 */
export async function createManualInvoice(db: Db, userId: string, input: ManualInvoiceInput): Promise<ManualInvoiceResult | null> {
  const description = input.description.trim();
  if (!description) throw new ManualInvoiceError("Η περιγραφή είναι υποχρεωτική.");
  const amount = normalizeAmount(input.amount);
  if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) throw new ManualInvoiceError("Το ποσό δεν είναι έγκυρο.");
  const quantity = (input.quantity ?? "1").trim().replace(",", ".") || "1";
  if (!/^\d+(\.\d+)?$/.test(quantity) || Number(quantity) <= 0) throw new ManualInvoiceError("Η ποσότητα δεν είναι έγκυρη.");

  const client = await getClient(db, userId, input.client_id);
  if (!client) return null;

  const profile = await loadProfile(db, userId);
  const blockers: string[] = [];
  const warnings: string[] = [];
  const plan = planInvoice(
    {
      type: "create_invoice",
      client_name: client.name,
      price_basis: input.price_basis,
      lines: [{ description, quantity, amount, amount_scope: "total" }],
    },
    profile,
    { client, newName: null },
    { documentTypeId: input.documentTypeId, lineVatCategoryIds: input.lineVatCategoryId ? [input.lineVatCategoryId] : undefined },
    blockers,
    warnings,
  );

  let invoice: InvoiceRow | null = null;
  if (plan.draft && blockers.length === 0) invoice = await insertDraft(db, userId, plan.draft);
  return { plan, invoice, blockers, warnings };
}
