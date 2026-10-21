import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * XSD validation of myDATA XML against the official v2.0.2 schemas under
 * ./xsd/v2.0.2/. Used as a hard gate in the tests (every generated document is
 * validated) and, defensively, before sending to AADE.
 *
 * Validation runs through xmllint (WebAssembly build of libxml2) so it needs no
 * native build and runs the same on CI, locally and on a serverless runtime.
 */
const XSD_DIR = join(dirname(fileURLToPath(import.meta.url)), "xsd", "v2.0.2");

/** Dependencies of each root schema, by their schemaLocation file names. */
const PRELOAD_FILES = [
  "SimpleTypes-v2.0.2.xsd",
  "TransportTypes-v2.0.2.xsd",
  "incomeClassification-v2.0.2.xsd",
  "expensesClassification-v2.0.2.xsd",
];

export type XsdSchema = "InvoicesDoc-v2.0.2.xsd" | "response-v2.0.2.xsd";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

type XmllintModule = {
  validateXML: (opts: {
    xml: Array<{ fileName: string; contents: string }>;
    schema: Array<{ fileName: string; contents: string }>;
    preload?: Array<{ fileName: string; contents: string }>;
  }) => Promise<{ valid: boolean; errors: Array<{ rawMessage?: string; message?: string } | string> }>;
};

let xmllint: Promise<XmllintModule> | null = null;
function loadXmllint(): Promise<XmllintModule> {
  // Lazy and cached: the WASM module is loaded once, and only when validation runs.
  if (!xmllint) {
    xmllint = import("xmllint-wasm").then((m: unknown) => {
      const mod = m as { validateXML?: XmllintModule["validateXML"]; default?: XmllintModule };
      const validateXML = mod.validateXML ?? mod.default?.validateXML;
      if (!validateXML) throw new Error("xmllint-wasm: validateXML not found");
      return { validateXML };
    });
  }
  return xmllint;
}

function read(fileName: string): string {
  return readFileSync(join(XSD_DIR, fileName), "utf8");
}

/** Validates an XML string against one of the vendored myDATA schemas. */
export async function validateXml(xml: string, schema: XsdSchema = "InvoicesDoc-v2.0.2.xsd"): Promise<ValidationResult> {
  const { validateXML } = await loadXmllint();
  const preload = PRELOAD_FILES.map((fileName) => ({ fileName, contents: read(fileName) }));
  const result = await validateXML({
    xml: [{ fileName: "document.xml", contents: xml }],
    schema: [{ fileName: schema, contents: read(schema) }],
    preload,
  });
  const errors = (result.errors ?? []).map((e) => (typeof e === "string" ? e : e.rawMessage ?? e.message ?? JSON.stringify(e)));
  return { valid: result.valid, errors };
}

export class XsdValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`XML is not valid against the myDATA XSD: ${errors.join("; ")}`);
    this.name = "XsdValidationError";
  }
}

/** Validates and throws XsdValidationError when the document does not conform. */
export async function assertValidXml(xml: string, schema: XsdSchema = "InvoicesDoc-v2.0.2.xsd"): Promise<void> {
  const { valid, errors } = await validateXml(xml, schema);
  if (!valid) throw new XsdValidationError(errors);
}
