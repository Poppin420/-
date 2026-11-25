import { useEffect, useState } from "react";
import { api, ApiError, type ServiceItem, type ServiceRecord } from "./api";

const today = () => new Date().toISOString().slice(0, 10);
/** YYYY-MM-DD -> DD/MM/YYYY (Greek), or a friendly label when unknown. */
const dmy = (iso: string | null) => {
  if (!iso) return "Χωρίς ημερομηνία";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};
/** One-line summary for a collapsed row. */
const summarize = (r: ServiceRecord) => r.work_type || (r.items.length > 0 ? r.items.slice(0, 3).join(", ") + (r.items.length > 3 ? "…" : "") : "—");

type Draft = { serviced_on: string; odometer: string; work_type: string; notes: string; amount: string; items: string[] };
const emptyDraft = (): Draft => ({ serviced_on: today(), odometer: "", work_type: "", notes: "", amount: "", items: [] });
const toDraft = (r: ServiceRecord): Draft => ({
  serviced_on: r.serviced_on?.slice(0, 10) ?? today(),
  odometer: r.odometer != null ? String(r.odometer) : "",
  work_type: r.work_type ?? "",
  notes: r.notes ?? "",
  amount: r.amount ?? "",
  items: [...r.items],
});
const euro = (s: string) => Number(s).toLocaleString("el-GR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

export function ServiceHistoryPanel({ vehicleId }: { vehicleId: string }) {
  const [records, setRecords] = useState<ServiceRecord[] | null>(null);
  const [checklist, setChecklist] = useState<ServiceItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [open, setOpen] = useState<string | null>(null);

  const load = async () => {
    try {
      const [{ records }, { items }] = await Promise.all([api.services(vehicleId), api.serviceItems(true)]);
      setRecords(records);
      setChecklist(items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Σφάλμα φόρτωσης.");
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);

  const toggleItem = (label: string) =>
    setDraft((d) => ({ ...d, items: d.items.includes(label) ? d.items.filter((i) => i !== label) : [...d.items, label] }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = { serviced_on: draft.serviced_on, odometer: draft.odometer, work_type: draft.work_type, notes: draft.notes, amount: draft.amount, items: draft.items };
      if (editing === "new") await api.createService(vehicleId, payload);
      else if (editing) await api.updateService(editing, payload);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Σφάλμα αποθήκευσης.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Να διαγραφεί η εγγραφή;")) return;
    setBusy(true);
    try {
      await api.deleteService(id);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Σφάλμα διαγραφής.");
    } finally {
      setBusy(false);
    }
  };

  // Group the checklist by category so the form shows sections.
  const groups = checklist.reduce<Record<string, ServiceItem[]>>((acc, it) => {
    const key = it.category ?? "Άλλα";
    (acc[key] ??= []).push(it);
    return acc;
  }, {});

  const form = (
    <div className="list-item form-grid">
      <label>
        Ημερομηνία
        <input type="date" value={draft.serviced_on} onChange={(e) => setDraft({ ...draft, serviced_on: e.target.value })} />
      </label>
      <label>
        Χιλιόμετρα
        <input inputMode="numeric" value={draft.odometer} placeholder="π.χ. 135000" onChange={(e) => setDraft({ ...draft, odometer: e.target.value })} />
      </label>
      <label>
        Είδος εργασίας
        <input value={draft.work_type} placeholder="π.χ. Μεγάλο service" onChange={(e) => setDraft({ ...draft, work_type: e.target.value })} />
      </label>
      <label>
        Χρέωση (€)
        <input inputMode="decimal" value={draft.amount} placeholder="π.χ. 65" onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
      </label>
      {checklist.length > 0 && (
        <div className="checklist">
          <span className="note">Τι έγινε:</span>
          {Object.entries(groups).map(([cat, items]) => (
            <div key={cat} className="checklist-group">
              <strong className="note">{cat}</strong>
              {items.map((it) => (
                <label key={it.id} className="checkbox">
                  <input type="checkbox" checked={draft.items.includes(it.label)} onChange={() => toggleItem(it.label)} />
                  {it.label}
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
      <label>
        Σημειώσεις
        <textarea value={draft.notes} rows={2} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
      </label>
      <div className="actions">
        <button className="primary" disabled={busy || !draft.serviced_on} onClick={save}>
          Αποθήκευση
        </button>
        <button disabled={busy} onClick={() => (setEditing(null), setError(null))}>
          Άκυρο
        </button>
      </div>
    </div>
  );

  return (
    <div className="history-panel">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {editing === "new" ? (
        form
      ) : (
        <button onClick={() => (setDraft(emptyDraft()), setEditing("new"))}>+ Νέα επίσκεψη / service</button>
      )}
      {records === null ? (
        <p className="note">Φόρτωση ιστορικού…</p>
      ) : records.length === 0 ? (
        <p className="note">Δεν υπάρχει ιστορικό ακόμη για αυτό το όχημα.</p>
      ) : (
        <>
        {(() => {
          const total = records.reduce((s, r) => s + (r.amount ? Number(r.amount) : 0), 0);
          return total > 0 ? (
            <p className="hist-total">
              Σύνολο χρεώσεων: <strong>{euro(String(total))}</strong> ({records.length} επισκέψεις)
            </p>
          ) : null;
        })()}
        <ul className="client-list">
          {records.map((r) =>
            editing === r.id ? (
              <li key={r.id}>{form}</li>
            ) : (
              <li key={r.id} className="list-item hist-item">
                <button className="hist-head" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <span className="hist-date">{dmy(r.serviced_on)}</span>
                  <span className="hist-sum note">
                    {r.odometer != null && `${r.odometer.toLocaleString("el-GR")} χλμ · `}
                    {summarize(r)}
                  </span>
                  {r.amount != null && <span className="hist-amount">{euro(r.amount)}</span>}
                  <span className="target-go">{open === r.id ? "▾" : "›"}</span>
                </button>
                {open === r.id && (
                  <div className="hist-body">
                    {r.odometer != null && (
                      <div>
                        <strong>Χιλιόμετρα:</strong> {r.odometer.toLocaleString("el-GR")}
                      </div>
                    )}
                    {r.work_type && (
                      <div>
                        <strong>Εργασία:</strong> {r.work_type}
                      </div>
                    )}
                    {r.amount != null && (
                      <div>
                        <strong>Χρέωση:</strong> {euro(r.amount)}
                      </div>
                    )}
                    {r.items.length > 0 && (
                      <div>
                        <strong>Έγιναν:</strong> {r.items.join(" · ")}
                      </div>
                    )}
                    {r.notes && (
                      <div className="note" style={{ whiteSpace: "pre-wrap" }}>
                        {r.notes}
                      </div>
                    )}
                    <div className="actions" style={{ marginTop: 8 }}>
                      <button onClick={() => (setDraft(toDraft(r)), setEditing(r.id))}>Επεξεργασία</button>
                      <button disabled={busy} onClick={() => remove(r.id)}>
                        Διαγραφή
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
        </>
      )}
    </div>
  );
}
