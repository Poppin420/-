import { useEffect, useMemo, useRef, useState } from "react";
import { formatEuro } from "@core/intent-parsing/resolve";
import { api, ApiError, type Client, type ServiceItem, type Vehicle } from "./api";

const today = () => new Date().toISOString().slice(0, 10);

/** The workshop's home: find or add a customer, then log the work and/or issue a receipt. */
export function ServiceEntryView() {
  const [picked, setPicked] = useState<Client | null>(null);
  if (picked) return <ClientHub client={picked} onBack={() => setPicked(null)} />;
  return <CustomerSearch onPick={setPicked} />;
}

// --- Customer search ----------------------------------------------------------

function CustomerSearch({ onPick }: { onPick: (c: Client) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Client[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let active = true;
    const id = setTimeout(async () => {
      try {
        const { clients } = await api.searchClients(term);
        if (active) setResults(clients);
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

  const addNew = async () => {
    setBusy(true);
    setError(null);
    try {
      const { client } = await api.createClient({ name: query.trim() });
      onPick(client);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Σφάλμα δημιουργίας.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="service-entry">
      <div className="panel">
        <h2>Νέα εργασία</h2>
        <p className="note">Γράψε όνομα πελάτη ή πινακίδα. Διάλεξε τον πελάτη για να σημειώσεις τι έγινε ή να κόψεις απόδειξη.</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <input
          className="service-search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Όνομα, παρατσούκλι ή πινακίδα…"
          aria-label="Αναζήτηση πελάτη ή πινακίδας"
        />
      </div>

      <div className="panel">
        {query.trim().length === 0 ? (
          <p className="note">Ξεκίνα να γράφεις για να βρεις πελάτη.</p>
        ) : (
          <>
            {searching && results.length === 0 && <p className="note">Αναζήτηση…</p>}
            {results.length > 0 && (
              <ul className="target-list">
                {results.map((c) => (
                  <li key={c.id}>
                    <button className="target-row" onClick={() => onPick(c)}>
                      <span className="target-main">
                        <strong>{c.name}</strong>
                        {(c.nickname || c.plate) && (
                          <span className="note">
                            {c.plate ? ` ${c.plate}` : ""}
                            {c.nickname ? ` «${c.nickname}»` : ""}
                          </span>
                        )}
                      </span>
                      <span className="target-go">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!searching && (
              <button className="primary add-new" disabled={busy} onClick={addNew}>
                ➕ Νέος πελάτης «{query.trim()}»
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// --- One customer: log work or issue a receipt --------------------------------

function ClientHub({ client, onBack }: { client: Client; onBack: () => void }) {
  const [mode, setMode] = useState<"service" | "receipt">("service");
  return (
    <section className="service-entry">
      <div className="panel">
        <button className="link-back" onClick={onBack}>
          ← Πίσω στην αναζήτηση
        </button>
        <h2>{client.name}</h2>
        {(client.plate || client.nickname) && (
          <p className="note">
            {client.plate && <span className="plate">{client.plate}</span>}
            {client.nickname && <span> «{client.nickname}»</span>}
          </p>
        )}
        <div className="seg">
          <button className={mode === "service" ? "active" : ""} onClick={() => setMode("service")}>
            🔧 Τι έγινε
          </button>
          <button className={mode === "receipt" ? "active" : ""} onClick={() => setMode("receipt")}>
            🧾 Απόδειξη
          </button>
        </div>
      </div>
      {mode === "service" ? <ServiceLog client={client} /> : <ReceiptForm client={client} />}
    </section>
  );
}

// --- Log what was done (per car) ----------------------------------------------

type SDraft = { serviced_on: string; odometer: string; work_type: string; notes: string; items: string[] };
const emptyS = (): SDraft => ({ serviced_on: today(), odometer: "", work_type: "", notes: "", items: [] });

function ServiceLog({ client }: { client: Client }) {
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [checklist, setChecklist] = useState<ServiceItem[]>([]);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [newPlate, setNewPlate] = useState("");
  const [draft, setDraft] = useState<SDraft>(emptyS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = async () => {
    try {
      const [{ vehicles }, { items }] = await Promise.all([api.vehicles(client.id), api.serviceItems(true)]);
      setVehicles(vehicles);
      setChecklist(items);
      if (vehicles.length === 1) setVehicleId(vehicles[0]!.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Σφάλμα φόρτωσης.");
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  const groups = useMemo(
    () =>
      checklist.reduce<Record<string, ServiceItem[]>>((acc, it) => {
        (acc[it.category ?? "Άλλα"] ??= []).push(it);
        return acc;
      }, {}),
    [checklist],
  );

  const addVehicle = async () => {
    if (!newPlate.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { vehicle } = await api.createVehicle(client.id, { plate: newPlate.trim() });
      setNewPlate("");
      setVehicles((vs) => [...(vs ?? []), vehicle]);
      setVehicleId(vehicle.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Σφάλμα.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (label: string) =>
    setDraft((d) => ({ ...d, items: d.items.includes(label) ? d.items.filter((i) => i !== label) : [...d.items, label] }));

  const save = async () => {
    if (!vehicleId) return;
    setBusy(true);
    setError(null);
    try {
      await api.createService(vehicleId, {
        serviced_on: draft.serviced_on,
        odometer: draft.odometer,
        work_type: draft.work_type,
        notes: draft.notes,
        items: draft.items,
      });
      const plate = vehicles?.find((v) => v.id === vehicleId)?.plate ?? "";
      setFlash(`✓ Καταχωρήθηκε ${plate}`);
      setDraft(emptyS());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Σφάλμα αποθήκευσης.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      {flash && <p className="note ok-note">{flash}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {vehicles === null ? (
        <p className="note">Φόρτωση…</p>
      ) : (
        <>
          <label>
            Όχημα
            <div className="chips">
              {vehicles.map((v) => (
                <button key={v.id} className={`chip ${vehicleId === v.id ? "active" : ""}`} onClick={() => setVehicleId(v.id)}>
                  {v.plate}
                  {v.make ? ` · ${v.make}` : ""}
                </button>
              ))}
            </div>
          </label>
          <div className="add-plate">
            <input value={newPlate} placeholder="Νέα πινακίδα…" autoCapitalize="characters" onChange={(e) => setNewPlate(e.target.value)} />
            <button disabled={busy || !newPlate.trim()} onClick={addVehicle}>
              ➕ Όχημα
            </button>
          </div>
        </>
      )}

      {vehicleId && (
        <div className="form-grid" style={{ marginTop: 12 }}>
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
            <button className="primary" disabled={busy || !draft.serviced_on} onClick={save}>
              {busy ? "Αποθήκευση…" : "Καταχώρηση"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Issue a receipt ----------------------------------------------------------

const PAYMENT_METHODS: Array<{ code: string; label: string }> = [
  { code: "3", label: "Μετρητά" },
  { code: "7", label: "POS / κάρτα" },
  { code: "1", label: "Επαγ. λογαριασμός ημεδαπής" },
  { code: "5", label: "Επί πιστώσει" },
  { code: "8", label: "IRIS" },
];

function ReceiptForm({ client }: { client: Client }) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [withVat, setWithVat] = useState(true);
  const [docChoice, setDocChoice] = useState<string | undefined>();
  const [draftId, setDraftId] = useState<string | null>(null);
  const [gross, setGross] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);
  const [docOptions, setDocOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [payment, setPayment] = useState("3");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<string | null>(null);

  const createDraft = async () => {
    setBusy(true);
    setError(null);
    setBlockers([]);
    try {
      const res = await api.createInvoice({
        client_id: client.id,
        description,
        amount,
        price_basis: withVat ? "with_vat" : "without_vat",
        documentTypeId: docChoice,
      });
      if (res.invoice) {
        setDraftId(res.invoice.id);
        setGross(res.invoice.draft.calc.totals.gross);
      } else {
        // The profile needs a choice (document type) or is incomplete.
        setDocOptions(res.plan.documentTypeChoice.options);
        setBlockers(res.blockers.length ? res.blockers : ["Συμπλήρωσε το προφίλ επιχείρησης από τις Ρυθμίσεις."]);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Σφάλμα.");
    } finally {
      setBusy(false);
    }
  };

  const issue = async () => {
    if (!draftId) return;
    setBusy(true);
    setError(null);
    try {
      await api.issueInvoice(draftId, payment);
      setIssued("✓ Η απόδειξη εκδόθηκε και στάλθηκε στην ΑΑΔΕ.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Σφάλμα έκδοσης.");
    } finally {
      setBusy(false);
    }
  };

  if (issued) {
    return (
      <div className="panel">
        <p className="note ok-note">{issued}</p>
        <a className="button" href="#/invoices">
          Δες τα παραστατικά
        </a>
      </div>
    );
  }

  // Draft made — offer issuing.
  if (draftId) {
    return (
      <div className="panel">
        <p>
          Προσχέδιο έτοιμο — σύνολο <strong>{gross ? formatEuro(gross) : ""}</strong> για «{description}».
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <label>
          Τρόπος πληρωμής
          <select value={payment} onChange={(e) => setPayment(e.target.value)}>
            {PAYMENT_METHODS.map((p) => (
              <option key={p.code} value={p.code}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <div className="actions">
          <button className="primary" disabled={busy} onClick={issue}>
            {busy ? "Έκδοση…" : "Έκδοση απόδειξης"}
          </button>
          <a className="button" href="#/invoices">
            Αργότερα (μένει προσχέδιο)
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {blockers.length > 0 && (
        <ul className="blockers">
          {blockers.map((b) => (
            <li key={b}>⛔ {b}</li>
          ))}
        </ul>
      )}
      <div className="form-grid">
        <label>
          Τι χρεώνεις
          <input value={description} placeholder="π.χ. Service & λάδια" onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label>
          Ποσό (€)
          <input inputMode="decimal" value={amount} placeholder="π.χ. 80" onChange={(e) => setAmount(e.target.value)} />
        </label>
        <div className="seg">
          <button className={withVat ? "active" : ""} onClick={() => setWithVat(true)}>
            Με ΦΠΑ
          </button>
          <button className={!withVat ? "active" : ""} onClick={() => setWithVat(false)}>
            Χωρίς ΦΠΑ
          </button>
        </div>
        {docOptions.length > 1 && (
          <label>
            Τύπος παραστατικού
            <select value={docChoice ?? ""} onChange={(e) => setDocChoice(e.target.value || undefined)}>
              <option value="">— διάλεξε —</option>
              {docOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="actions">
          <button className="primary" disabled={busy || !description.trim() || !amount.trim()} onClick={createDraft}>
            {busy ? "…" : "Συνέχεια"}
          </button>
        </div>
      </div>
    </div>
  );
}
