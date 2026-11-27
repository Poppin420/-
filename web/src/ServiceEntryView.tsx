import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type Client, type ServiceItem, type Vehicle } from "./api";

const today = () => new Date().toISOString().slice(0, 10);

/** The workshop's home: find or add a customer, then log the work on their vehicle. */
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
  const [adding, setAdding] = useState(false);
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


  return (
    <section className="service-entry">
      <div className="panel">
        <h2>Νέα εργασία</h2>
        <p className="note">Γράψε όνομα πελάτη ή πινακίδα. Μετά δουλεύεις με κουμπιά.</p>
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
        {adding ? (
          <NewCustomerForm initialName={query.trim()} onCancel={() => setAdding(false)} onCreated={onPick} />
        ) : query.trim().length === 0 ? (
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
              <button className="primary add-new" onClick={() => setAdding(true)}>
                ➕ Νέος πελάτης «{query.trim()}»
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// --- New customer together with their car, in one step ------------------------

function NewCustomerForm({ initialName, onCancel, onCreated }: { initialName: string; onCancel: () => void; onCreated: (c: Client) => void }) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState("");
  const [plate, setPlate] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [engine, setEngine] = useState("");
  const [vin, setVin] = useState("");
  const [engineNo, setEngineNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) {
      setError("Γράψε όνομα πελάτη.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { client } = await api.createClient({ name: name.trim(), phone: phone.trim() || undefined });
      if (plate.trim()) {
        await api.createVehicle(client.id, {
          plate: plate.trim(),
          make: make.trim() || undefined,
          model: model.trim() || undefined,
          engine: engine.trim() || undefined,
          vin: vin.trim() || undefined,
          engine_no: engineNo.trim() || undefined,
        });
      }
      onCreated(client);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Σφάλμα δημιουργίας.");
    } finally {
      setBusy(false);
    }
  };

  const f = (label: string, value: string, set: (v: string) => void, props: Record<string, unknown> = {}) => (
    <label>
      {label}
      <input value={value} onChange={(e) => set(e.target.value)} {...props} />
    </label>
  );

  return (
    <div className="form-grid">
      <h3>Νέος πελάτης & όχημα</h3>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {f("Όνομα πελάτη", name, setName, { autoFocus: true })}
      {f("Τηλέφωνο", phone, setPhone, { inputMode: "tel", placeholder: "προαιρετικό" })}
      {f("Πινακίδα", plate, setPlate, { autoCapitalize: "characters", placeholder: "π.χ. ΑΒΓ-1234" })}
      {f("Μάρκα", make, setMake, { placeholder: "Toyota" })}
      {f("Μοντέλο", model, setModel, { placeholder: "Yaris" })}
      {f("Κυβικά", engine, setEngine, { placeholder: "1400" })}
      {f("Αρ. πλαισίου (VIN)", vin, setVin)}
      {f("Αρ. κινητήρα", engineNo, setEngineNo)}
      <div className="actions">
        <button className="primary" disabled={busy || !name.trim()} onClick={save}>
          Αποθήκευση
        </button>
        <button disabled={busy} onClick={onCancel}>
          Άκυρο
        </button>
      </div>
    </div>
  );
}

// --- One customer: log what was done ------------------------------------------

function ClientHub({ client, onBack }: { client: Client; onBack: () => void }) {
  const [checklist, setChecklist] = useState<ServiceItem[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        setChecklist((await api.serviceItems(true)).items);
      } catch {
        setChecklist([]);
      }
    })();
  }, []);

  const toggle = (label: string) =>
    setSelected((s) => (s.includes(label) ? s.filter((i) => i !== label) : [...s, label]));

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
      </div>
      <ServiceLog client={client} checklist={checklist} selected={selected} onToggle={toggle} />
    </section>
  );
}

// --- "Τι έγινε": big service buttons, optional car + km -------------------------

function ServiceLog({
  client,
  checklist,
  selected,
  onToggle,
}: {
  client: Client;
  checklist: ServiceItem[] | null;
  selected: string[];
  onToggle: (label: string) => void;
}) {
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [newPlate, setNewPlate] = useState("");
  const [km, setKm] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = async () => {
    try {
      const { vehicles } = await api.vehicles(client.id);
      setVehicles(vehicles);
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
      (checklist ?? []).reduce<Record<string, ServiceItem[]>>((acc, it) => {
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

  const saveHistory = async () => {
    if (!vehicleId) return;
    setBusy(true);
    setError(null);
    try {
      await api.createService(vehicleId, { serviced_on: today(), odometer: km, items: selected, notes, amount });
      const plate = vehicles?.find((v) => v.id === vehicleId)?.plate ?? "";
      setFlash(`✓ Καταχωρήθηκε στο ιστορικό ${plate}`);
      setNotes("");
      setAmount("");
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

      {/* Car: optional, needed only to save to history */}
      {vehicles !== null && (
        <div className="svc-car">
          {vehicles.length > 0 && (
            <div className="chips">
              {vehicles.map((v) => (
                <button key={v.id} className={`chip ${vehicleId === v.id ? "active" : ""}`} onClick={() => setVehicleId(v.id)}>
                  {v.plate}
                  {v.make ? ` · ${v.make}` : ""}
                </button>
              ))}
            </div>
          )}
          <div className="add-plate">
            <input value={newPlate} placeholder="Πινακίδα αμαξιού…" autoCapitalize="characters" onChange={(e) => setNewPlate(e.target.value)} />
            <button disabled={busy || !newPlate.trim()} onClick={addVehicle}>
              ➕ Αμάξι
            </button>
          </div>
        </div>
      )}

      {/* The service buttons, always visible */}
      <p className="note svc-title">Πάτα ό,τι έκανες:</p>
      {checklist === null ? (
        <p className="note">Φόρτωση…</p>
      ) : checklist.length === 0 ? (
        <p className="note">
          Δεν υπάρχουν υπηρεσίες ακόμη. Πρόσθεσέ τες από Ρυθμίσεις → «Λίστα εργασιών».
        </p>
      ) : (
        Object.entries(groups).map(([cat, items]) => (
          <div key={cat} className="svc-group">
            <strong className="note">{cat}</strong>
            <div className="svc-grid">
              {items.map((it) => (
                <button key={it.id} className={`svc-btn ${selected.includes(it.label) ? "active" : ""}`} onClick={() => onToggle(it.label)}>
                  {it.label}
                </button>
              ))}
            </div>
          </div>
        ))
      )}

      <label className="svc-km">
        Χιλιόμετρα (προαιρετικό)
        <input inputMode="numeric" value={km} placeholder="π.χ. 135000" onChange={(e) => setKm(e.target.value)} />
      </label>
      <label className="svc-km">
        Χρέωση (€)
        <input inputMode="decimal" value={amount} placeholder="π.χ. 65" onChange={(e) => setAmount(e.target.value)} />
      </label>
      <label className="svc-km">
        Σημειώσεις (π.χ. τι ανταλλακτικό έβαλες)
        <textarea value={notes} rows={2} placeholder="π.χ. Έβαλα φίλτρο λαδιού Bosch, τακάκια εμπρός" onChange={(e) => setNotes(e.target.value)} />
      </label>

      <div className="actions">
        <button className="primary" disabled={busy || !vehicleId || selected.length === 0} onClick={saveHistory} title={!vehicleId ? "Διάλεξε ή πρόσθεσε αμάξι" : ""}>
          Αποθήκευση στο ιστορικό
        </button>
      </div>
      {!vehicleId && vehicles !== null && selected.length > 0 && (
        <p className="note">Για να κρατηθεί στο ιστορικό του αμαξιού, διάλεξε ή πρόσθεσε πινακίδα πάνω.</p>
      )}
    </div>
  );
}
