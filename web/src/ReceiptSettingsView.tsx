import { useEffect, useState } from "react";
import {
  hasPrintBridge,
  listPrinters,
  printReceiptHtml,
  receiptPrinter,
  receiptWidthMm,
  setReceiptPrinter,
  setReceiptWidthMm,
} from "./print";
import { sampleReceiptHtml } from "./receipt";

export function ReceiptSettingsView() {
  const [width, setWidth] = useState(receiptWidthMm());
  const [printer, setPrinter] = useState(receiptPrinter());
  const [printers, setPrinters] = useState<Array<{ name: string; displayName?: string }>>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bridge = hasPrintBridge();

  useEffect(() => {
    if (bridge) listPrinters().then(setPrinters).catch(() => {});
  }, [bridge]);

  const chooseWidth = (w: number) => {
    setWidth(w);
    setReceiptWidthMm(w);
  };
  const choosePrinter = (n: string) => {
    setPrinter(n);
    setReceiptPrinter(n);
  };
  const test = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await printReceiptHtml(sampleReceiptHtml(width));
      setMsg("✓ Στάλθηκε δοκιμαστική εκτύπωση στον εκτυπωτή.");
    } catch (e) {
      setMsg("Σφάλμα εκτύπωσης: " + (e instanceof Error ? e.message : "άγνωστο"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings">
      <div className="panel">
        <h2>Εκτύπωση αποδείξεων</h2>
        <p className="note">
          Μόλις εκδίδεις απόδειξη, τυπώνεται αυτόματα στον θερμικό εκτυπωτή με τα στοιχεία και το QR της ΑΑΔΕ.
        </p>
        {msg && <p className="note ok-note">{msg}</p>}

        <label>
          Πλάτος χαρτιού
          <div className="seg">
            <button className={width === 80 ? "active" : ""} onClick={() => chooseWidth(80)}>
              80mm (φαρδύ)
            </button>
            <button className={width === 58 ? "active" : ""} onClick={() => chooseWidth(58)}>
              58mm (στενό)
            </button>
          </div>
        </label>

        {bridge ? (
          <label>
            Εκτυπωτής
            <select value={printer} onChange={(e) => choosePrinter(e.target.value)}>
              <option value="">Προεπιλεγμένος εκτυπωτής των Windows</option>
              {printers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName || p.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="note">Η αυτόματη εκτύπωση δουλεύει στην εφαρμογή υπολογιστή. Εδώ (στον browser) θα ανοίγει το παράθυρο εκτύπωσης.</p>
        )}

        <div className="actions">
          <button className="primary" disabled={busy} onClick={test}>
            {busy ? "Εκτύπωση…" : "Δοκιμαστική εκτύπωση"}
          </button>
        </div>
        <p className="note">
          Συμβουλή: αν δεν ξέρεις το πλάτος, δοκίμασε πρώτα 80mm. Αν η απόδειξη βγαίνει κομμένη δεξιά, άλλαξε σε 58mm.
        </p>
      </div>
    </section>
  );
}
