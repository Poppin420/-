import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type ServiceItem, type ServiceTarget } from "./api";

const today = () => new Date().toISOString().slice(0, 10);

type Draft = { serviced_on: string; odometer: string; work_type: string; notes: string; items: string[] };
const emptyDraft = (): Draft => ({ serviced_on: today(), odometer: "", work_type: "", notes: "", items: [] });

/**
 * The workshop's main daily action: log what was done and for which car, fast.
 * Everything loads once up front and search runs in memory, so there is no wait
 * per keystroke and no recording/transcription step that can hang.
 */
export function ServiceEntryView() {
  const [checklist, setChecklist] = useState<ServiceItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ServiceTarget[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<ServiceTarget | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Only the (small) checklist loads up front, so the home screen opens instantly
  // however large the database is.
  useEffect(() => {
    void (async () => {
      try {
        setChecklist((await api.serviceItems(true)).items);
      } catch {
        /* the checklist is optional for logging a job */
      }
    })();
  }, []);

  // Search runs on the server, debounced, with the latest query winning the race.
  useEffect(() => {
    const term = query.trim();
    if (term.length === 0) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let active = true;
    const id = setTimeout(async () => {
      try {
        const { targets } = await api.serviceTargets(term);
        if (active) setResults(targets);
      } catch (e) {
        if (active) setError(e instanceof ApiError ? e.message : "Σφάλμα αναζήτησης.");
      } finally {
        if (active) setSearching(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [query]);

  const groups = useMemo(() => {
    return checklist.reduce<Record<string, ServiceItem[]>>((acc, it) => {
      (acc[it.category ?? "Άλλα"] ??= []).push(it);
      return acc;
    }, {});
  }, [checklist]);

  const toggle = (label: string) =>
    setDraft((d) => ({ ...d, items: d.items.includes(label) ? d.items.filter((i) => i !== label) : [...d.items, label] }));

  const pick = (t: ServiceTarget) => {
    setPicked(t);
    setDraft(emptyDraft());
    setFlash(null);
    setError(null);
  };

  const save = async () => {
    if (!picked) return;
    setSaving(true);
    setError(null);
    try {
      await api.createService(picked.id, {
        serviced_on: draft.serviced_on,
        odometer: draft.odometer,
        work_type: draft.work_type,
        notes: draft.notes,
        items: draft.items,
      });
      setFlash(`✓ Καταχωρήθηκε για ${picked.client_name} — ${picked.plate}`);
      setPicked(null);
      setQuery("");
      searchRef.current?.focus();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Σφάλμα αποθήκευσης.");
    } finally {
      setSaving(false);
    }
  };

  // The form for the picked car.
  if (picked) {
    return (
      <section className="service-entry">
        <div className="panel">
          <button className="link-back" onClick={() => setPicked(null)}>
            ← Πίσω
          </button>
          <h2>
            <span className="plate">{picked.plate}</span> {picked.client_name}
          </h2>
          {picked.make && <p className="note">{[picked.make, picked.model].filter(Boolean).join(" ")}</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="form-grid">
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
            {checklist.length > 0 && (
              <div className="checklist">
                <span className="note">Τι έγινε:</span>
                {Object.entries(groups).map(([cat, items]) => (
                  <div key={cat} className="checklist-group">
                    <strong className="note">{cat}</strong>
                    {items.map((it) => (
                      <label key={it.id} className="checkbox">
                        <input type="checkbox" checked={draft.items.includes(it.label)} onChange={() => toggle(it.label)} />
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
              <button className="primary" disabled={saving || !draft.serviced_on} onClick={save}>
                {saving ? "Αποθήκευση…" : "Καταχώρηση"}
              </button>
              <button disabled={saving} onClick={() => setPicked(null)}>
                Άκυρο
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // The search screen (home).
  return (
    <section className="service-entry">
      <div className="panel">
        <h2>Νέα εργασία</h2>
        <p className="note">Γράψε πινακίδα ή όνομα πελάτη, διάλεξε το αμάξι και σημείωσε τι έγινε.</p>
        {flash && <p className="note ok-note">{flash}</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <input
          ref={searchRef}
          className="service-search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Πινακίδα ή όνομα…"
          aria-label="Αναζήτηση πινακίδας ή πελάτη"
        />
      </div>

      <div className="panel">
        {query.trim().length === 0 ? (
          <p className="note">Ξεκίνα να γράφεις για να βρεις αμάξι ή πελάτη.</p>
        ) : searching && results.length === 0 ? (
          <p className="note">Αναζήτηση…</p>
        ) : results.length === 0 ? (
          <>
            <p className="note">Δεν βρέθηκε αμάξι ή πελάτης.</p>
            <a className="button" href="#/clients">
              Πρόσθεσε πελάτη / όχημα
            </a>
          </>
        ) : (
          <ul className="target-list">
            {results.map((t) => (
              <li key={t.id}>
                <button className="target-row" onClick={() => pick(t)}>
                  <span className="plate">{t.plate}</span>
                  <span className="target-main">
                    <strong>{t.client_name}</strong>
                    {(t.make || t.model) && <span className="note"> {[t.make, t.model].filter(Boolean).join(" ")}</span>}
                  </span>
                  <span className="target-go">›</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
