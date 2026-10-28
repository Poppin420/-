import { useEffect, useState } from "react";
import { api, ApiError, type BusinessProfile, type ProfileResponse } from "./api";

type P = BusinessProfile;
const newId = () => crypto.randomUUID().slice(0, 8);

export function ProfileView() {
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [p, setP] = useState<P | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .profile()
      .then((r) => (setData(r), setP(r.profile)))
      .catch((e) => setMessage({ ok: false, text: e instanceof ApiError ? e.message : "Σφάλμα φόρτωσης." }));
  }, []);

  if (!p || !data) return <p className="note">{message?.text ?? "Φόρτωση…"}</p>;

  const set = <K extends keyof P>(key: K, value: P[K]) => setP({ ...p, [key]: value });
  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api.saveProfile(p);
      setData(r);
      setP(r.profile);
      setMessage({ ok: true, text: r.issues.length === 0 ? "Αποθηκεύτηκε. Το προφίλ είναι πλήρες." : "Αποθηκεύτηκε. Λείπουν ακόμη στοιχεία." });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : "Σφάλμα." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings profile">
      <a className="link" href="#/settings">
        ‹ Ρυθμίσεις
      </a>
      <div className="panel">
        <h2>Προφίλ επιχείρησης</h2>
        <p className="note">
          Τα φορολογικά στοιχεία τα ορίζεις εσύ ή ο λογιστής σου. Το σύστημα δεν μαντεύει καθεστώς ΦΠΑ, κατηγορίες ή
          κωδικούς από το επάγγελμα. Αν το προφίλ είναι ελλιπές, η έκδοση παραστατικών μπλοκάρει.
        </p>
        {!data.spec.verified && (
          <p className="notice">
            Οι κωδικοί ΑΑΔΕ που θα συμπληρώσεις θα ελεγχθούν αυτόματα όταν φορτωθεί η επίσημη προδιαγραφή myDATA.
          </p>
        )}
        {data.issues.length > 0 && (
          <ul className="blockers">
            {data.issues.map((i) => (
              <li key={i.field + i.message}>⛔ {i.message}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel form-grid">
        <h2>Στοιχεία επιχείρησης</h2>
        <Field label="ΑΦΜ" value={p.afm} onChange={(v) => set("afm", v)} inputMode="numeric" />
        <Field label="Επωνυμία / ονοματεπώνυμο" value={p.legal_name} onChange={(v) => set("legal_name", v)} />
        <Field label="Διακριτικός τίτλος" value={p.trade_name} onChange={(v) => set("trade_name", v)} />
        <Field label="ΔΟΥ" value={p.doy} onChange={(v) => set("doy", v)} />
        <Field label="Οδός" value={p.address.street} onChange={(v) => set("address", { ...p.address, street: v })} />
        <Field label="Αριθμός" value={p.address.number} onChange={(v) => set("address", { ...p.address, number: v })} />
        <Field label="ΤΚ" value={p.address.postal_code} onChange={(v) => set("address", { ...p.address, postal_code: v })} inputMode="numeric" />
        <Field label="Πόλη" value={p.address.city} onChange={(v) => set("address", { ...p.address, city: v })} />
        <Field label="Δραστηριότητα" value={p.activity} onChange={(v) => set("activity", v)} />
        <Field label="Εγκατάσταση (0 = έδρα)" value={p.branch} onChange={(v) => set("branch", v)} inputMode="numeric" />
        <label>
          Καθεστώς ΦΠΑ
          <select value={p.vat_regime} onChange={(e) => set("vat_regime", e.target.value as P["vat_regime"])}>
            <option value="">— επίλεξε —</option>
            <option value="normal">Κανονικό καθεστώς</option>
            <option value="exempt">Απαλλαγή</option>
          </select>
        </label>
      </div>

      <ListEditor
        title="Κατηγορίες ΦΠΑ"
        items={p.vat_categories}
        onChange={(v) => set("vat_categories", v)}
        blank={() => ({ id: newId(), label: "", rate: "", aade_code: "", exemption_code: "" })}
        render={(c, update) => (
          <>
            <label className="check">
              <input type="radio" name="default-vat" checked={p.default_vat_category_id === c.id} onChange={() => set("default_vat_category_id", c.id)} />
              Προεπιλογή
            </label>
            <Field label="Όνομα" value={c.label} onChange={(v) => update({ ...c, label: v })} />
            <Field label="Συντελεστής %" value={c.rate} onChange={(v) => update({ ...c, rate: v.replace(",", ".") })} inputMode="decimal" />
            <Field label="Κωδικός ΑΑΔΕ" value={c.aade_code} onChange={(v) => update({ ...c, aade_code: v })} />
            <Field label="Κωδικός απαλλαγής (για 0%)" value={c.exemption_code} onChange={(v) => update({ ...c, exemption_code: v })} />
          </>
        )}
      />

      <ListEditor
        title="Τύποι παραστατικών και σειρές"
        items={p.document_types}
        onChange={(v) => set("document_types", v)}
        blank={() => ({ id: newId(), label: "", aade_code: "", counterpart: "consumer" as const, series: "", income_classification_category: "", income_classification_type: "" })}
        render={(d, update) => (
          <>
            <Field label="Όνομα" value={d.label} onChange={(v) => update({ ...d, label: v })} />
            <Field label="Κωδικός τύπου ΑΑΔΕ" value={d.aade_code} onChange={(v) => update({ ...d, aade_code: v })} />
            <label>
              Προς
              <select value={d.counterpart} onChange={(e) => update({ ...d, counterpart: e.target.value as "business" | "consumer" })}>
                <option value="consumer">Ιδιώτες</option>
                <option value="business">Επιχειρήσεις</option>
              </select>
            </label>
            <Field label="Σειρά" value={d.series} onChange={(v) => update({ ...d, series: v })} />
            <Field label="Χαρακτηρισμός εσόδων: κατηγορία" value={d.income_classification_category} onChange={(v) => update({ ...d, income_classification_category: v })} />
            <Field label="Χαρακτηρισμός εσόδων: τύπος" value={d.income_classification_type} onChange={(v) => update({ ...d, income_classification_type: v })} />
          </>
        )}
      />

      <ListEditor
        title="Κρατήσεις / παρακρατήσεις"
        items={p.withholdings}
        onChange={(v) => set("withholdings", v)}
        blank={() => ({ id: newId(), label: "", rate: "", aade_code: "", applies_to: "business_customers" as const })}
        render={(w, update) => (
          <>
            <Field label="Όνομα" value={w.label} onChange={(v) => update({ ...w, label: v })} />
            <Field label="Ποσοστό % επί καθαρής αξίας" value={w.rate} onChange={(v) => update({ ...w, rate: v.replace(",", ".") })} inputMode="decimal" />
            <Field label="Κωδικός ΑΑΔΕ" value={w.aade_code} onChange={(v) => update({ ...w, aade_code: v })} />
            <label>
              Εφαρμόζεται
              <select value={w.applies_to} onChange={(e) => update({ ...w, applies_to: e.target.value as "business_customers" | "all" })}>
                <option value="business_customers">Μόνο σε πελάτες επιχειρήσεις</option>
                <option value="all">Σε όλα τα παραστατικά</option>
              </select>
            </label>
          </>
        )}
      />

      <ListEditor
        title="Κατάλογος υπηρεσιών / ειδών"
        items={p.catalog}
        onChange={(v) => set("catalog", v)}
        blank={() => ({ id: newId(), name: "", unit_price: "", price_basis: "with_vat" as const, vat_category_id: p.default_vat_category_id })}
        render={(item, update) => (
          <>
            <Field label="Όνομα" value={item.name} onChange={(v) => update({ ...item, name: v })} />
            <Field label="Τιμή" value={item.unit_price} onChange={(v) => update({ ...item, unit_price: v.replace(",", ".") })} inputMode="decimal" />
            <label>
              Η τιμή είναι
              <select value={item.price_basis} onChange={(e) => update({ ...item, price_basis: e.target.value as "with_vat" | "without_vat" })}>
                <option value="with_vat">Με ΦΠΑ</option>
                <option value="without_vat">Χωρίς ΦΠΑ</option>
              </select>
            </label>
            <label>
              Κατηγορία ΦΠΑ
              <select value={item.vat_category_id} onChange={(e) => update({ ...item, vat_category_id: e.target.value })}>
                {p.vat_categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} ({c.rate}%)
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      />

      <div className="panel">
        <label className="check">
          <input type="checkbox" checked={p.reviewed_by_accountant} onChange={(e) => set("reviewed_by_accountant", e.target.checked)} />
          Τα φορολογικά στοιχεία ελέγχθηκαν από λογιστή.
        </label>
        {message && <p className={message.ok ? "note ok-note" : "error"}>{message.text}</p>}
        <button className="primary" onClick={save} disabled={busy}>
          Αποθήκευση προφίλ
        </button>
      </div>
    </section>
  );
}

function Field(props: { label: string; value: string; onChange: (v: string) => void; inputMode?: "numeric" | "decimal" }) {
  return (
    <label>
      {props.label}
      <input value={props.value} inputMode={props.inputMode} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}

function ListEditor<T extends { id: string }>(props: {
  title: string;
  items: T[];
  onChange: (items: T[]) => void;
  blank: () => T;
  render: (item: T, update: (item: T) => void) => React.ReactNode;
}) {
  return (
    <div className="panel form-grid">
      <h2>{props.title}</h2>
      {props.items.length === 0 && <p className="note">Καμία εγγραφή.</p>}
      {props.items.map((item) => (
        <fieldset key={item.id} className="list-item">
          {props.render(item, (next) => props.onChange(props.items.map((x) => (x.id === item.id ? next : x))))}
          <button className="danger small" onClick={() => props.onChange(props.items.filter((x) => x.id !== item.id))}>
            Αφαίρεση
          </button>
        </fieldset>
      ))}
      <button onClick={() => props.onChange([...props.items, props.blank()])}>+ Προσθήκη</button>
    </div>
  );
}
