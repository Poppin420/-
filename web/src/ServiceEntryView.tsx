import { useEffect, useState } from "react";
import { api, ApiError, type Client, type ServiceTarget } from "./api";
import { ServiceHistoryPanel } from "./ServiceHistoryPanel";

/** The workshop's home: find a car by plate (or owner), then log work and see its history. */
export function ServiceEntryView() {
  const [picked, setPicked] = useState<ServiceTarget | null>(null);
  if (picked) return <VehicleWork target={picked} onBack={() => setPicked(null)} />;
  return <CarSearch onPick={setPicked} />;
}

// --- Search a car by plate or owner, or add a new customer + car ---------------

function CarSearch({ onPick }: { onPick: (t: ServiceTarget) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ServiceTarget[]>([]);
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

  return (
    <section className="service-entry">
      <div className="panel">
        <h2>Νέα εργασία</h2>
        <p className="note">Γράψε πινακίδα ή όνομα πελάτη και διάλεξε το αμάξι.</p>
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
          placeholder="Πινακίδα ή όνομα…"
          aria-label="Αναζήτηση αμαξιού ή πελάτη"
        />
      </div>

      <div className="panel">
        {adding ? (
          <NewCustomerForm initialName={query.trim()} onCancel={() => setAdding(false)} onCreated={onPick} />
        ) : query.trim().length === 0 ? (
          <p className="note">Ξεκίνα να γράφεις για να βρεις αμάξι.</p>
        ) : (
          <>
            {searching && results.length === 0 && <p className="note">Αναζήτηση…</p>}
            {results.length > 0 && (
              <ul className="target-list">
                {results.map((t) => (
                  <li key={t.id}>
                    <button className="target-row" onClick={() => onPick(t)}>
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
            {!searching && (
              <button className="primary add-new" onClick={() => setAdding(true)}>
                ➕ Νέος πελάτης & όχημα
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// --- One car: its history and a quick "new service" --------------------------

function VehicleWork({ target, onBack }: { target: ServiceTarget; onBack: () => void }) {
  return (
    <section className="service-entry">
      <div className="panel">
        <button className="link-back" onClick={onBack}>
          ← Πίσω στην αναζήτηση
        </button>
        <h2>
          <span className="plate">{target.plate}</span> {target.client_name}
        </h2>
        {(target.make || target.model) && <p className="note">{[target.make, target.model].filter(Boolean).join(" ")}</p>}
        <ServiceHistoryPanel vehicleId={target.id} />
      </div>
    </section>
  );
}

// --- New customer together with their car, in one step ------------------------

function NewCustomerForm({ initialName, onCancel, onCreated }: { initialName: string; onCancel: () => void; onCreated: (t: ServiceTarget) => void }) {
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
    if (!plate.trim()) {
      setError("Γράψε πινακίδα για να ανοίξεις το αμάξι.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { client } = await api.createClient({ name: name.trim(), phone: phone.trim() || undefined });
      const { vehicle } = await api.createVehicle(client.id, {
        plate: plate.trim(),
        make: make.trim() || undefined,
        model: model.trim() || undefined,
        engine: engine.trim() || undefined,
        vin: vin.trim() || undefined,
        engine_no: engineNo.trim() || undefined,
      });
      onCreated({
        id: vehicle.id,
        plate: vehicle.plate,
        make: vehicle.make,
        model: vehicle.model,
        client_id: client.id,
        client_name: client.name,
        client_nickname: client.nickname ?? null,
      });
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
        <button className="primary" disabled={busy || !name.trim() || !plate.trim()} onClick={save}>
          Αποθήκευση & άνοιγμα
        </button>
        <button disabled={busy} onClick={onCancel}>
          Άκυρο
        </button>
      </div>
    </div>
  );
}
