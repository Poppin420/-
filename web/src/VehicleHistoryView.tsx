import { useEffect, useState } from "react";
import { api, ApiError, type ServiceTarget } from "./api";
import { ServiceHistoryPanel } from "./ServiceHistoryPanel";

/** A tab for looking up a car and seeing its full service history. */
export function VehicleHistoryView() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ServiceTarget[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<ServiceTarget | null>(null);

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
          {(picked.make || picked.model) && <p className="note">{[picked.make, picked.model].filter(Boolean).join(" ")}</p>}
          <ServiceHistoryPanel vehicleId={picked.id} />
        </div>
      </section>
    );
  }

  return (
    <section className="service-entry">
      <div className="panel">
        <h2>Ιστορικό αμαξιού</h2>
        <p className="note">Γράψε πινακίδα ή όνομα πελάτη και διάλεξε το αμάξι για να δεις το ιστορικό του.</p>
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
          aria-label="Αναζήτηση αμαξιού"
        />
      </div>

      <div className="panel">
        {query.trim().length === 0 ? (
          <p className="note">Ξεκίνα να γράφεις για να βρεις αμάξι.</p>
        ) : searching && results.length === 0 ? (
          <p className="note">Αναζήτηση…</p>
        ) : results.length === 0 ? (
          <p className="note">Δεν βρέθηκε αμάξι.</p>
        ) : (
          <ul className="target-list">
            {results.map((t) => (
              <li key={t.id}>
                <button className="target-row" onClick={() => setPicked(t)}>
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
