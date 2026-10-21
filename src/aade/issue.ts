import { DateTime } from "luxon";
import type { AppContext } from "../server/context";
import { DbError, PG_UNIQUE_VIOLATION } from "../db/db";
import { ZONE } from "../intent-parsing/greekDate";
import type { BusinessProfile } from "../invoicing/profile";
import { nextNumber, type InvoiceRow, type InvoiceStatus } from "../invoicing/invoices";
import type { AadeEnvironment } from "./credentials";
import { loadCredentials } from "./credentials";
import { buildInvoiceXml } from "./xml";
import { assertValidXml } from "./validate";
import { sendInvoices, type SendResult } from "./client";
import type { AadeResponseError } from "./response";

export interface IssueResult {
  status: InvoiceStatus;
  mark: string | null;
  uid: string | null;
  errors: AadeResponseError[];
}

export class IssueError extends Error {
  constructor(
    message: string,
    readonly kind: "credentials" | "numbering" | "xml",
  ) {
    super(message);
    this.name = "IssueError";
  }
}

const SEND_OUTCOME_STATUS = { issued: "issued", rejected: "rejected", unknown: "unknown" } as const;

/**
 * Sends a draft to myDATA and records the outcome. Callers must have run
 * `issueChecks` and confirmed they all pass; this function trusts that and
 * performs the transmission.
 *
 * The document number is claimed by moving the row to `sending` before the
 * network call, so a crash mid-flight leaves it `sending` (reserved), never
 * lost or duplicated. The outcome is then written per README Φ4.
 */
export async function issueInvoice(
  ctx: AppContext,
  userId: string,
  invoice: InvoiceRow,
  profile: BusinessProfile,
  opts: { environment: AadeEnvironment; issueDate?: string; fetchImpl?: typeof fetch },
): Promise<IssueResult> {
  const env = opts.environment;
  const creds = await loadCredentials(ctx, userId, env).catch(() => null);
  if (!creds) throw new IssueError("myDATA credentials are not configured", "credentials");

  const draft = invoice.draft;
  const series = draft.document_type.series;
  if (!series) throw new IssueError("the document type has no series", "numbering");
  const issueDate = opts.issueDate ?? DateTime.fromJSDate(ctx.now()).setZone(ZONE).toISODate()!;
  const aa = await nextNumber(ctx.db, userId, env, draft.document_type.id, series);

  const xml = buildInvoiceXml({
    issuer: { afm: profile.afm, branch: profile.branch },
    draft,
    series,
    aa,
    issueDate,
  });
  // Defense in depth: never transmit XML that does not conform to the XSD.
  await assertValidXml(xml);

  // Claim the number: draft -> sending. The partial unique index on
  // (user, env, type, series, number) rejects a clash with another in-flight doc.
  try {
    const claimed = await ctx.db.query(
      `update invoices
         set status = 'sending', environment = $3, number = $4, issue_date = $5, request_xml = $6, updated_at = now()
       where id = $1 and user_id = $2 and status = 'draft'
       returning id`,
      [invoice.id, userId, env, aa, issueDate, xml],
    );
    if (claimed.length === 0) throw new IssueError("the document is no longer a draft", "numbering");
  } catch (e) {
    if (e instanceof DbError && e.code === PG_UNIQUE_VIOLATION) {
      throw new IssueError("the next number was just taken by another document; try again", "numbering");
    }
    throw e;
  }

  const result = await sendInvoices({ environment: env, credentials: creds, fetchImpl: opts.fetchImpl }, xml);
  return persistOutcome(ctx, userId, invoice.id, result);
}

async function persistOutcome(ctx: AppContext, userId: string, invoiceId: string, result: SendResult): Promise<IssueResult> {
  const status = SEND_OUTCOME_STATUS[result.outcome];
  if (result.outcome === "issued") {
    await ctx.db.query(
      `update invoices
         set status = 'issued', mark = $3, uid = $4, response_body = $5, aade_error = null, issued_at = now(), updated_at = now()
       where id = $1 and user_id = $2 and status = 'sending'`,
      [invoiceId, userId, result.mark, result.uid, result.responseBody],
    );
  } else {
    // rejected: the number is freed (status is outside the numbering index), per Φ4.
    // unknown: the number stays reserved until the document is checked against AADE.
    await ctx.db.query(
      `update invoices
         set status = $3, response_body = $4, aade_error = $5, updated_at = now()
       where id = $1 and user_id = $2 and status = 'sending'`,
      [invoiceId, userId, status, result.responseBody, JSON.stringify({ errors: result.errors, httpStatus: result.httpStatus })],
    );
  }
  return { status, mark: result.mark, uid: result.uid, errors: result.errors };
}
