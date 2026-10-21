/**
 * Parser for the myDATA `ResponseDoc` returned by SendInvoices and
 * CancelInvoice (response-v2.0.2.xsd). The schema is flat and namespace-free,
 * so a small, strict extractor is enough and keeps the function dependency-free.
 */

export interface AadeResponseError {
  message: string;
  code: string;
}

export interface AadeResponse {
  index: number | null;
  statusCode: string;
  invoiceUid: string | null;
  invoiceMark: string | null;
  classificationMark: string | null;
  cancellationMark: string | null;
  qrUrl: string | null;
  errors: AadeResponseError[];
}

export interface ResponseDoc {
  responses: AadeResponse[];
}

function unescape(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

/** First text value of `<tag>…</tag>` (ignoring any element prefix), or null. */
function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<(?:[\\w.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`));
  return m ? unescape(m[1]!.trim()) : null;
}

function allBlocks(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`, "g");
  const out: string[] = [];
  for (let m = re.exec(xml); m; m = re.exec(xml)) out.push(m[1]!);
  return out;
}

export class ResponseParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResponseParseError";
  }
}

export function parseResponseDoc(xml: string): ResponseDoc {
  if (!/<(?:[\w.-]+:)?ResponseDoc\b/.test(xml)) {
    throw new ResponseParseError("not a ResponseDoc");
  }
  const responses = allBlocks(xml, "response").map((block) => {
    const indexRaw = tag(block, "index");
    const statusCode = tag(block, "statusCode");
    if (!statusCode) throw new ResponseParseError("response without statusCode");
    const errors = allBlocks(block, "error").map((e) => ({
      message: tag(e, "message") ?? "",
      code: tag(e, "code") ?? "",
    }));
    return {
      index: indexRaw !== null ? Number(indexRaw) : null,
      statusCode,
      invoiceUid: tag(block, "invoiceUid"),
      invoiceMark: tag(block, "invoiceMark"),
      classificationMark: tag(block, "classificationMark"),
      cancellationMark: tag(block, "cancellationMark"),
      qrUrl: tag(block, "qrUrl"),
      errors,
    };
  });
  return { responses };
}

/** True when every response in the document reports success. */
export function isSuccess(doc: ResponseDoc): boolean {
  return doc.responses.length > 0 && doc.responses.every((r) => r.statusCode.toLowerCase() === "success");
}
