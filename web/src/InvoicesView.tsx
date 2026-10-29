import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type InvoiceDetail, type InvoiceRow } from "./api";
import { InvoiceBreakdown } from "./InvoiceBreakdown";
import { formatEuro } from "@core/intent-parsing/resolve";

const PAYMENT_METHODS: Array<{ code: string; label: string }> = [
  { code: "3", label: "Μετρητά" },
  { code: "7", label: "POS / κάρτα" },
  { code: "1", label: "Επαγ. λογαριασμός ημεδαπής" },
  { code: "2", label: "Επαγ. λογαριασμός αλλοδαπής" },
  { code: "4", label: "Επιταγή" },
  { code: "5", label: "Επί πιστώσει" },
  { code: "6", label: "Web banking" },
  { code: "8", label: "IRIS" },
];

const STATUS: Record<InvoiceRow["status"], string> = {
  draft: "Προσχέδιο",
  sending: "Αποστέλλεται",
  issued: "Εκδόθηκε",
  rejected: "Απορρίφθηκε",
  unknown: "Άγνωστη κατάσταση",
  cancelled: "Ακυρώθηκε",
};

const PAGE_SIZE = 50;

export function InvoicesView() {
  const [list, setList] = useState<InvoiceRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.invoices({ q: q || undefined, status: status || undefined, limit: PAGE_SIZE, offset });
        setList((prev) => (offset === 0 ? res.invoices : [...prev, ...res.invoices]));
        setHasMore(res.hasMore);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Σφάλμα φόρτωσης.");
      } finally {
        setLoading(false);
      }
    },
    [q, status],
  );
  useEffect(() => void load(0), [load]);

  if (open) return <InvoiceDetailView id={open} onBack={() => (setOpen(null), void load(0))} />;

  const filtering = q !== "" || status !== "";
  return (
    <section className="invoices">
      <h2 className="cal-title">Παραστατικά</h2>

      <form
        className="invoice-search"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(input.trim());
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Αναζήτηση: πελάτης, αριθμός, ΜΑΡΚ…" aria-label="Αναζήτηση παραστατικών" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Κατάσταση">
          <option value="">Όλες</option>
          {Object.entries(STATUS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button type="submit">Αναζήτηση</button>
      </form>

      {error && <p className="error">{error}</p>}
      {!loading && list.length === 0 && (
        <p className="note">
          {filtering ? "Κανένα παραστατικό δεν ταιριάζει." : "Δεν υπάρχουν ακόμη παραστατικά. Πες π.χ. «Κόψε απόδειξη 40 ευρώ με ΦΠΑ στη Μαρία για μάθημα»."}
        </p>
      )}

      <ul className="appts">
        {list.map((inv) => (
          <li key={inv.id} className="appt invoice-row" onClick={() => setOpen(inv.id)}>
            <div className="appt-body">
              <strong>{inv.draft.customer.name}</strong>
              <span className="appt-title">
                {inv.draft.document_type.label} · {inv.series}
                {inv.number ? ` ${inv.number}` : ""}
              </span>
            </div>
            <div className="inv-amount">
              {formatEuro(inv.draft.calc.totals.gross)}
              <span className={`badge ${inv.status === "issued" ? "ok" : "muted"}`}>{STATUS[inv.status]}</span>
            </div>
          </li>
        ))}
      </ul>

      {loading && <p className="note">Φόρτωση…</p>}
      {hasMore && !loading && (
        <button className="load-more" onClick={() => void load(list.length)}>
          Φόρτωσε περισσότερα
        </button>
      )}
    </section>
  );
}

function InvoiceDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paymentType, setPaymentType] = useState("3");

  const load = useCallback(async () => {
    try {
      setDetail(await api.invoice(id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Σφάλμα φόρτωσης.");
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  if (!detail) return <p className="note">{error ?? "Φόρτωση…"}</p>;
  const { invoice, issuer, checks } = detail;
  const d = invoice.draft;
  const allOk = checks.length > 0 && checks.every((c) => c.ok);

  const issue = async () => {
    if (!window.confirm(`Έκδοση ${d.document_type.label} ${formatEuro(d.calc.totals.gross)} προς ${d.customer.name} στο ΔΟΚΙΜΑΣΤΙΚΟ περιβάλλον της ΑΑΔΕ;`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.issueInvoice(id, paymentType);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Η έκδοση απέτυχε.");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Διαγραφή του προσχεδίου;")) return;
    try {
      await api.deleteInvoice(id);
      onBack();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Η διαγραφή απέτυχε.");
    }
  };

  return (
    <section className="invoice-detail">
      <button className="link" onClick={onBack}>
        ‹ Πίσω
      </button>
      <article className="card">
        <header className="card-head">
          <h3>{d.document_type.label}</h3>
          <span className="env test">ΔΟΚΙΜΑΣΤΙΚΟ</span>
        </header>
        <dl className="fields">
          <Row label="Κατάσταση" value={STATUS[invoice.status]} />
          <Row label="Εκδότης" value={`${issuer.legal_name || "—"}, ΑΦΜ ${issuer.afm || "—"}, ΔΟΥ ${issuer.doy || "—"}`} />
          <Row label="Διεύθυνση" value={[issuer.address.street, issuer.address.number, issuer.address.postal_code, issuer.address.city].filter(Boolean).join(" ") || "—"} />
          <Row label="Εγκατάσταση" value={issuer.branch} />
          <Row label="Πελάτης" value={`${d.customer.name}${d.customer.vat_number ? `, ΑΦΜ ${d.customer.vat_number}` : " (ιδιώτης)"}`} />
          <Row label="Κωδικός τύπου" value={d.document_type.aade_code} />
          <Row label="Σειρά / αριθμός" value={`${d.document_type.series} / ${invoice.number ?? "θα δοθεί κατά την έκδοση"}`} />
          <Row label="Χαρακτηρισμός εσόδων" value={`${d.document_type.income_classification_category} / ${d.document_type.income_classification_type}`} />
          <Row label="Τιμές" value={d.price_basis === "with_vat" ? "Με ΦΠΑ" : "Χωρίς ΦΠΑ"} />
          {d.lines.map((l, i) => (
            <Row key={i} label={`Κατηγορία ΦΠΑ ${d.lines.length > 1 ? i + 1 : ""}`} value={`${l.vat_category_label} · κωδ. ${l.vat_aade_code}${l.exemption_code ? ` · απαλλαγή ${l.exemption_code}` : ""}`} />
          ))}
          {invoice.mark && <Row label="ΜΑΡΚ" value={invoice.mark} />}
          {invoice.uid && <Row label="UID" value={invoice.uid} />}
        </dl>
        <InvoiceBreakdown calc={d.calc} />

        {invoice.status === "draft" && (
          <>
            <h4>Υποχρεωτικοί έλεγχοι πριν την έκδοση</h4>
            <ul className="checks">
              {checks.map((c) => (
                <li key={c.code} className={c.ok ? "ok" : "fail"}>
                  {c.ok ? "✅" : "⛔"} {c.message}
                </li>
              ))}
            </ul>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <label className="payment-method">
              Τρόπος πληρωμής
              <select value={paymentType} onChange={(e) => setPaymentType(e.target.value)} disabled={busy}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="actions">
              <button className="primary" disabled={!allOk || busy} onClick={issue}>
                Έκδοση
              </button>
              <button className="danger" onClick={remove} disabled={busy}>
                Διαγραφή προσχεδίου
              </button>
            </div>
          </>
        )}
      </article>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
