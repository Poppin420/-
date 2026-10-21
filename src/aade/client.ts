import { parseResponseDoc, isSuccess, type AadeResponseError, type ResponseDoc } from "./response";
import type { AadeCredentials, AadeEnvironment } from "./credentials";

/**
 * myDATA REST client for the ERP route (SendInvoices, CancelInvoice).
 *
 * Only the test environment is used before phase δ; production URLs are here so
 * the switch is a one-line change once production is enabled. Credentials go in
 * the `aade-user-id` and `ocp-apim-subscription-key` headers and are never
 * logged.
 *
 * Outcome mapping follows README Φ4:
 *  - a parsed Success response → "issued" (the number is used);
 *  - a parsed failure, or an HTTP error that still carried a response document
 *    → "rejected" (the document did not register, so the number is reused);
 *  - a timeout, a network error, a 5xx or an unreadable body → "unknown" (it may
 *    have registered, so the number stays reserved until checked against AADE).
 */

const URLS: Record<AadeEnvironment, string> = {
  test: "https://mydataapidev.aade.gr/",
  prod: "https://mydatapi.aade.gr/myDATA/",
};

export type SendOutcome = "issued" | "rejected" | "unknown";

export interface SendResult {
  outcome: SendOutcome;
  httpStatus: number | null;
  responseBody: string;
  parsed: ResponseDoc | null;
  mark: string | null;
  uid: string | null;
  qrUrl: string | null;
  cancellationMark: string | null;
  errors: AadeResponseError[];
}

export interface AadeClientOptions {
  environment: AadeEnvironment;
  credentials: AadeCredentials;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function headers(creds: AadeCredentials): Record<string, string> {
  return {
    "aade-user-id": creds.username,
    "ocp-apim-subscription-key": creds.subscriptionKey,
    "Content-Type": "text/xml; charset=utf-8",
    Accept: "application/xml",
  };
}

async function call(opts: AadeClientOptions, action: string, query: Record<string, string>, body: string | null): Promise<{ httpStatus: number; body: string } | { error: "network" | "timeout" }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = URLS[opts.environment];
  const qs = Object.keys(query).length ? `?${new URLSearchParams(query).toString()}` : "";
  const url = `${base}${action}${qs}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: headers(opts.credentials),
      body: body ?? undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    return { httpStatus: res.status, body: text };
  } catch (e) {
    return { error: (e as { name?: string }).name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

function interpret(result: { httpStatus: number; body: string } | { error: "network" | "timeout" }): SendResult {
  const base: SendResult = {
    outcome: "unknown",
    httpStatus: null,
    responseBody: "error" in result ? "" : result.body,
    parsed: null,
    mark: null,
    uid: null,
    qrUrl: null,
    cancellationMark: null,
    errors: [],
  };
  if ("error" in result) {
    return { ...base, responseBody: result.error };
  }
  base.httpStatus = result.httpStatus;
  let parsed: ResponseDoc;
  try {
    parsed = parseResponseDoc(result.body);
  } catch {
    // A response we cannot read: treat as unknown unless the HTTP status already
    // tells us the request was rejected before any document was registered.
    base.outcome = result.httpStatus === 401 || result.httpStatus === 403 ? "rejected" : "unknown";
    if (base.outcome === "rejected") base.errors = [{ code: String(result.httpStatus), message: "authentication or authorization failed" }];
    return base;
  }
  base.parsed = parsed;
  const first = parsed.responses[0];
  base.mark = first?.invoiceMark ?? null;
  base.uid = first?.invoiceUid ?? null;
  base.qrUrl = first?.qrUrl ?? null;
  base.cancellationMark = first?.cancellationMark ?? null;
  base.errors = parsed.responses.flatMap((r) => r.errors);
  base.outcome = isSuccess(parsed) ? "issued" : "rejected";
  return base;
}

/** Sends one or more invoices (an InvoicesDoc XML) to myDATA. */
export async function sendInvoices(opts: AadeClientOptions, invoicesDocXml: string): Promise<SendResult> {
  return interpret(await call(opts, "SendInvoices", {}, invoicesDocXml));
}

/** Cancels a registered document by its mark. The cancellation itself gets a mark. */
export async function cancelInvoice(opts: AadeClientOptions, mark: string, entityVatNumber?: string): Promise<SendResult> {
  const query: Record<string, string> = { mark };
  if (entityVatNumber) query.entityVatNumber = entityVatNumber;
  return interpret(await call(opts, "CancelInvoice", query, null));
}
