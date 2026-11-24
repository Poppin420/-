import { buildReceiptHtml } from "./receipt";
import type { InvoiceDetail } from "./api";

// Per-machine receipt settings (desktop single-user app), kept in localStorage.
export function receiptWidthMm(): number {
  try {
    return Number(localStorage.getItem("receiptWidthMm")) || 80;
  } catch {
    return 80;
  }
}
export function setReceiptWidthMm(w: number) {
  try {
    localStorage.setItem("receiptWidthMm", String(w));
  } catch {
    /* ignore */
  }
}
export function receiptPrinter(): string {
  try {
    return localStorage.getItem("receiptPrinter") || "";
  } catch {
    return "";
  }
}
export function setReceiptPrinter(name: string) {
  try {
    localStorage.setItem("receiptPrinter", name);
  } catch {
    /* ignore */
  }
}

// Bridge exposed by the Electron preload; absent in a plain browser.
interface SynergeioApi {
  printReceipt(html: string, deviceName: string): Promise<{ ok: boolean; error?: string }>;
  listPrinters(): Promise<Array<{ name: string; displayName?: string }>>;
}
function bridge(): SynergeioApi | null {
  return (window as unknown as { synergeio?: SynergeioApi }).synergeio ?? null;
}
export function hasPrintBridge(): boolean {
  return !!bridge();
}
export function listPrinters(): Promise<Array<{ name: string; displayName?: string }>> {
  return bridge()?.listPrinters() ?? Promise.resolve([]);
}

/** Prints receipt HTML: silently via Electron to the chosen/default printer, or via the browser dialog. */
export async function printReceiptHtml(html: string): Promise<void> {
  const b = bridge();
  if (b) {
    const res = await b.printReceipt(html, receiptPrinter());
    if (!res.ok) throw new Error(res.error || "Η εκτύπωση απέτυχε.");
    return;
  }
  // Browser fallback: hidden iframe + the system print dialog.
  const iframe = document.createElement("iframe");
  Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow!.document;
  doc.open();
  doc.write(html);
  doc.close();
  await new Promise((r) => setTimeout(r, 300));
  iframe.contentWindow!.focus();
  iframe.contentWindow!.print();
  setTimeout(() => iframe.remove(), 1500);
}

export function printReceipt(detail: InvoiceDetail): Promise<void> {
  return printReceiptHtml(buildReceiptHtml(detail, receiptWidthMm()));
}
