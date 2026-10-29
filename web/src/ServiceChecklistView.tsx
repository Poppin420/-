import { useEffect, useState } from "react";
import { api, ApiError, type ServiceItem } from "./api";

export function ServiceChecklistView() {
  const [items, setItems] = useState<ServiceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const load = async () => {
    try {
      setItems((await api.serviceItems()).items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Σφάλμα φόρτωσης.");
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const guard = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Σφάλμα.");
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    guard(async () => {
      if (!label.trim()) return;
      await api.createServiceItem({ label, category: category.trim() || null });
      setLabel("");
      setCategory("");
    });

  const rename = (id: string) =>
    guard(async () => {
      await api.updateServiceItem(id, { label: editLabel });
      setEditId(null);
    });

  // Known categories, to offer as suggestions when adding a task.
  const categories = [...new Set((items ?? []).map((i) => i.category).filter(Boolean) as string[])];

  return (
    <section className="checklist-view">
      <div className="panel">
        <h2>Λίστα εργασιών συνεργείου</h2>
        <p className="note">
          Αυτές οι εργασίες εμφανίζονται ως λίστα ελέγχου σε κάθε service. Ξεκίνησες με μια προεπιλεγμένη λίστα· πρόσθεσε, μετονόμασε ή απόκρυψε
          ό,τι θέλεις.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-grid">
          <label>
            Νέα εργασία
            <input value={label} placeholder="π.χ. Ευθυγράμμιση" onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label>
            Κατηγορία (προαιρετικό)
            <input value={category} list="svc-cats" placeholder="π.χ. Ανάρτηση / φρένα" onChange={(e) => setCategory(e.target.value)} />
            <datalist id="svc-cats">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <div className="actions">
            <button className="primary" disabled={busy || !label.trim()} onClick={add}>
              + Προσθήκη
            </button>
          </div>
        </div>
      </div>

      <div className="panel">
        {items === null ? (
          <p className="note">Φόρτωση…</p>
        ) : (
          <ul className="client-list">
            {items.map((it) => (
              <li key={it.id} className="list-item">
                <div className="client-row">
                  {editId === it.id ? (
                    <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
                  ) : (
                    <div>
                      <strong style={{ opacity: it.active ? 1 : 0.5 }}>{it.label}</strong>
                      {it.category && <span className="note"> · {it.category}</span>}
                      {!it.active && <span className="note"> (κρυμμένη)</span>}
                    </div>
                  )}
                  <div className="actions" style={{ marginTop: 0 }}>
                    {editId === it.id ? (
                      <>
                        <button className="primary" disabled={busy} onClick={() => rename(it.id)}>
                          Αποθήκευση
                        </button>
                        <button disabled={busy} onClick={() => setEditId(null)}>
                          Άκυρο
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => (setEditId(it.id), setEditLabel(it.label))}>Μετονομασία</button>
                        <button disabled={busy} onClick={() => guard(() => api.updateServiceItem(it.id, { active: !it.active }))}>
                          {it.active ? "Απόκρυψη" : "Εμφάνιση"}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => {
                            if (confirm("Να διαγραφεί η εργασία;")) void guard(() => api.deleteServiceItem(it.id));
                          }}
                        >
                          Διαγραφή
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
