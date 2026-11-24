import qrcode from "qrcode-generator";
import type { InvoiceDetail } from "./api";

/** Builds a self-contained HTML receipt sized for a thermal printer (58 or 80 mm). */
export function buildReceiptHtml(detail: InvoiceDetail, widthMm: number): string {
  const { invoice, issuer } = detail;
  const d = invoice.draft;
  const narrow = widthMm <= 60;
  const fontPx = narrow ? 9 : 11;

  const shopName = issuer.trade_name || issuer.legal_name || "";
  const a = issuer.address;
  const addr = a
    ? [[a.street, a.number].filter(Boolean).join(" "), [a.postal_code, a.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")
    : "";
  const date = invoice.issue_date ? dmy(invoice.issue_date) : dmy(new Date().toISOString());
  const docLine = [d.document_type.label, invoice.series && `Σειρά ${invoice.series}`, invoice.number && `Αρ. ${invoice.number}`]
    .filter(Boolean)
    .join(" · ");

  const itemRows = d.calc.lines
    .map((l) => {
      const qty = l.quantity && l.quantity !== "1" ? `${deci(l.quantity)} × ` : "";
      return `<div class="item"><div class="d">${esc(l.description)}</div><div class="r">${qty}${euro(l.gross)}</div></div>`;
    })
    .join("");

  const vatRows = d.calc.by_rate
    .map((r) => `<div class="row"><span>ΦΠΑ ${deci(r.vat_rate)}%</span><span>${euro(r.vat)}</span></div>`)
    .join("");

  const withholding =
    Number(d.calc.totals.withholdings) > 0
      ? `<div class="row"><span>Παρακράτηση</span><span>-${euro(d.calc.totals.withholdings)}</span></div>`
      : "";

  const aade = invoice.mark
    ? `<div class="sep"></div>
       <div class="center small">ΜΑΡΚ: ${esc(invoice.mark)}</div>
       ${invoice.uid ? `<div class="center small">UID: ${esc(invoice.uid)}</div>` : ""}
       ${invoice.qr_url ? `<div class="center qr">${qrSvg(invoice.qr_url)}</div>` : ""}
       <div class="center small">Σήμανση myDATA · ΑΑΔΕ</div>`
    : `<div class="sep"></div><div class="center small">Προσχέδιο — δεν έχει σταλεί στην ΑΑΔΕ</div>`;

  return `<!doctype html><html lang="el"><head><meta charset="utf-8">
<style>
  @page { margin: 0; }
  * { box-sizing: border-box; }
  html,body { margin:0; padding:0; }
  body { width:${widthMm}mm; font-family: "Consolas","Courier New",monospace; font-size:${fontPx}px; color:#000; }
  .wrap { padding:3mm 2mm; }
  .center { text-align:center; }
  .bold { font-weight:700; }
  .big { font-size:${fontPx + 4}px; }
  .small { font-size:${fontPx - 1}px; }
  .name { font-size:${fontPx + 3}px; font-weight:700; text-align:center; }
  .sep { border-top:1px dashed #000; margin:2mm 0; }
  .row { display:flex; justify-content:space-between; }
  .item { margin:1mm 0; }
  .item .r { text-align:right; }
  .qr svg { width:${narrow ? 28 : 34}mm; height:${narrow ? 28 : 34}mm; }
</style></head>
<body><div class="wrap">
  <div class="name">${esc(shopName)}</div>
  ${issuer.activity ? `<div class="center small">${esc(issuer.activity)}</div>` : ""}
  ${addr ? `<div class="center small">${esc(addr)}</div>` : ""}
  <div class="center small">ΑΦΜ ${esc(issuer.afm || "")}${issuer.doy ? ` · ΔΟΥ ${esc(issuer.doy)}` : ""}</div>
  <div class="sep"></div>
  <div class="small">${esc(docLine)}</div>
  <div class="small">Ημερομηνία: ${date}</div>
  ${d.customer.name ? `<div class="small">Πελάτης: ${esc(d.customer.name)}${d.customer.vat_number ? ` (ΑΦΜ ${esc(d.customer.vat_number)})` : ""}</div>` : ""}
  <div class="sep"></div>
  ${itemRows}
  <div class="sep"></div>
  <div class="row"><span>Καθαρή αξία</span><span>${euro(d.calc.totals.net)}</span></div>
  ${vatRows}
  <div class="row"><span>Σύνολο ΦΠΑ</span><span>${euro(d.calc.totals.vat)}</span></div>
  ${withholding}
  <div class="row bold big"><span>ΣΥΝΟΛΟ</span><span>${euro(d.calc.totals.payable)}</span></div>
  ${aade}
</div></body></html>`;
}

/** A representative receipt for the "test print" button (no real data needed). */
export function sampleReceiptHtml(widthMm: number): string {
  const detail = {
    invoice: {
      series: "A",
      number: 1,
      issue_date: new Date().toISOString().slice(0, 10),
      mark: "400001234567890",
      uid: "ABC123DEF456GHI789",
      qr_url: "https://www1.aade.gr/myDATA/sample-qr",
      draft: {
        customer: { name: "Πελάτης Δοκιμή", vat_number: null, counterpart: "consumer" },
        document_type: { label: "Απόδειξη Λιανικής", series: "A" },
        calc: {
          lines: [
            { description: "Αλλαγή λαδιών & φίλτρο", quantity: "1", gross: "62.00" },
            { description: "Υγρά φρένων", quantity: "1", gross: "15.00" },
          ],
          by_rate: [{ vat_rate: "24", net: "62.10", vat: "14.90" }],
          totals: { net: "62.10", vat: "14.90", gross: "77.00", withholdings: "0.00", payable: "77.00" },
        },
      },
    },
    issuer: {
      trade_name: "ΣΥΝΕΡΓΕΙΟ",
      legal_name: "",
      activity: "Συνεργείο αυτοκινήτων",
      address: { street: "Λεωφ. Παράδειγμα", number: "1", postal_code: "11111", city: "Αθήνα" },
      afm: "123456789",
      doy: "Α' Αθηνών",
    },
  } as unknown as InvoiceDetail;
  return buildReceiptHtml(detail, widthMm);
}

function qrSvg(url: string): string {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  return qr.createSvgTag({ cellSize: 2, margin: 0, scalable: true });
}

function euro(s: string): string {
  return Number(s).toLocaleString("el-GR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
function deci(s: string): string {
  return s.replace(".", ",");
}
function dmy(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}
