import { useEffect, useState } from "react";
import { api, ApiError, type Vehicle } from "./api";

type Draft = { plate: string; make: string; model: string; engine: string; vin: string; year: string; notes: string };

const EMPTY: Draft = { plate: "", make: "", model: "", engine: "", vin: "", year: "", notes: "" };
const toDraft = (v: Vehicle): Draft => ({
  plate: v.plate,
  make: v.make ?? "",
  model: v.model ?? "",
  engine: v.engine ?? "",
  vin: v.vin ?? "",
  year: v.year != null ? String(v.year) : "",
  notes: v.notes ?? "",
});

const summary = (v: Vehicle): string =>
  [v.make, v.model, v.year, v.engine].filter(Boolean).join(" · ");

export function VehiclesPanel({ clientId }: { clientId: string }) {
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const load = async () => {
    try {
      setVehicles((await api.vehicles(clientId)).vehicles);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Σφάλμα φόρτωσης.");
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        plate: draft.plate,
        make: draft.make,
        model: draft.model,
        engine: draft.engine,
        vin: draft.vin,
        year: draft.year,
        notes: draft.notes,
      };
      if (editing === "new") await api.createVehicle(clientId, payload);
      else if (editing) await api.updateVehicle(editing, payload);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Σφάλμα αποθήκευσης.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Να διαγραφεί το όχημα;")) return;
    setBusy(true);
    try {
      await api.deleteVehicle(id);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Σφάλμα διαγραφής.");
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, key: keyof Draft, props: Record<string, unknown> = {}) => (
    <label>
      {label}
      <input value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} {...props} />
    </label>
  );

  const form = (
    <div className="list-item form-grid">
      {field("Πινακίδα", "plate", { placeholder: "π.χ. ΑΒΓ-1234", autoCapitalize: "characters" })}
      {field("Μάρκα", "make", { placeholder: "Toyota" })}
      {field("Μοντέλο", "model", { placeholder: "Yaris" })}
      {field("Κινητήρας / κυβικά", "engine", { placeholder: "1400cc" })}
      {field("Έτος", "year", { inputMode: "numeric", placeholder: "2015" })}
      {field("Αριθμός πλαισίου (VIN)", "vin")}
      {field("Σημειώσεις", "notes")}
      <div className="actions">
        <button className="primary" disabled={busy || !draft.plate.trim()} onClick={save}>
          Αποθήκευση
        </button>
        <button disabled={busy} onClick={() => (setEditing(null), setError(null))}>
          Άκυρο
        </button>
      </div>
    </div>
  );

  return (
    <div className="vehicles-panel">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {vehicles === null ? (
        <p className="note">Φόρτωση οχημάτων…</p>
      ) : (
        <ul className="client-list">
          {vehicles.map((v) =>
            editing === v.id ? (
              <li key={v.id}>{form}</li>
            ) : (
              <li key={v.id} className="list-item">
                <div className="client-row">
                  <div>
                    <span className="plate">{v.plate}</span>
                    {summary(v) && <span className="note"> {summary(v)}</span>}
                    {v.notes && <div className="note">{v.notes}</div>}
                  </div>
                  <div className="actions" style={{ marginTop: 0 }}>
                    <button onClick={() => (setDraft(toDraft(v)), setEditing(v.id))}>Επεξεργασία</button>
                    <button disabled={busy} onClick={() => remove(v.id)}>
                      Διαγραφή
                    </button>
                  </div>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
      {editing === "new" ? (
        form
      ) : (
        <button onClick={() => (setDraft(EMPTY), setEditing("new"))}>+ Όχημα</button>
      )}
    </div>
  );
}
