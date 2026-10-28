import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Appointment } from "./api";
import { addDays, dateOf, dayTitle, time, todayIso, weekStart } from "./format";

type Mode = "day" | "week";

export function CalendarView({ googleConnected }: { googleConnected: boolean }) {
  const [mode, setMode] = useState<Mode>("day");
  const [anchor, setAnchor] = useState(todayIso);
  const [items, setItems] = useState<Appointment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const from = mode === "day" ? anchor : weekStart(anchor);
  const to = mode === "day" ? anchor : addDays(from, 6);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems((await api.appointments(from, to)).appointments);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Σφάλμα φόρτωσης.");
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const cancel = async (a: Appointment) => {
    if (!window.confirm(`Ακύρωση του ραντεβού ${a.client_name} στις ${time(a.starts_at)};`)) return;
    try {
      await api.cancel(a.id);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Η ακύρωση απέτυχε.");
    }
  };

  const retry = async (a: Appointment) => {
    try {
      await api.retrySync(a.id);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Ο συγχρονισμός απέτυχε.");
    }
  };

  const days = mode === "day" ? [anchor] : Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const step = mode === "day" ? 1 : 7;

  return (
    <section className="calendar">
      <div className="cal-toolbar">
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={mode === "day"} className={mode === "day" ? "active" : ""} onClick={() => setMode("day")}>
            Ημέρα
          </button>
          <button role="tab" aria-selected={mode === "week"} className={mode === "week" ? "active" : ""} onClick={() => setMode("week")}>
            Εβδομάδα
          </button>
        </div>
        <div className="cal-nav">
          <button aria-label="Προηγούμενο" onClick={() => setAnchor(addDays(anchor, -step))}>
            ‹
          </button>
          <button onClick={() => setAnchor(todayIso())}>Σήμερα</button>
          <button aria-label="Επόμενο" onClick={() => setAnchor(addDays(anchor, step))}>
            ›
          </button>
        </div>
      </div>
      <h2 className="cal-title">{mode === "day" ? dayTitle(anchor) : `${dayTitle(from)} – ${dayTitle(to)}`}</h2>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {items === null && !error && <p className="note">Φόρτωση…</p>}

      {items &&
        days.map((day) => {
          const dayItems = items.filter((a) => dateOf(a.starts_at) === day);
          if (mode === "week" && dayItems.length === 0) {
            return (
              <div key={day} className="cal-day empty">
                <h3>{dayTitle(day)}</h3>
                <p className="note">—</p>
              </div>
            );
          }
          return (
            <div key={day} className="cal-day">
              {mode === "week" && <h3>{dayTitle(day)}</h3>}
              {dayItems.length === 0 && <p className="note">Κανένα ραντεβού.</p>}
              <ul className="appts">
                {dayItems.map((a) => (
                  <li key={a.id} className="appt">
                    <div className="appt-time">
                      {time(a.starts_at)}
                      <span>{time(a.ends_at)}</span>
                    </div>
                    <div className="appt-body">
                      <strong>{a.client_name}</strong>
                      {a.title && <span className="appt-title">{a.title}</span>}
                      {googleConnected && a.google_sync_status === "failed" && (
                        <button className="link warn" onClick={() => retry(a)}>
                          Δεν συγχρονίστηκε με Google · Ξανά
                        </button>
                      )}
                    </div>
                    <button className="danger small" onClick={() => cancel(a)} aria-label={`Ακύρωση ${a.client_name}`}>
                      Ακύρωση
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
    </section>
  );
}
