import { useState } from "react";
import { api, ApiError, type Me } from "./api";

export function SettingsView({ me, notice, onChanged, onLoggedOut }: {
  me: Me;
  notice: string | null;
  onChanged: () => void;
  onLoggedOut: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Σφάλμα.");
    } finally {
      setBusy(false);
    }
  };

  const connect = () => guard(async () => {
    const { url } = await api.googleConnect();
    window.location.href = url;
  });

  const disconnect = () => guard(async () => {
    if (!window.confirm("Αποσύνδεση από το Google Calendar; Τα υπάρχοντα γεγονότα στο Google δεν θα διαγραφούν.")) return;
    await api.googleDisconnect();
    onChanged();
  });

  const deleteAccount = () => guard(async () => {
    const password = window.prompt(
      "Η διαγραφή είναι οριστική: σβήνονται λογαριασμός, πελάτες και ραντεβού. Γράψε τον κωδικό σου για επιβεβαίωση:",
    );
    if (!password) return;
    await api.deleteAccount(password);
    onLoggedOut();
  });

  return (
    <section className="settings">
      {notice && <p className="note ok-note">{notice}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="panel">
        <h2>Λογαριασμός</h2>
        <p>{me.user.email}</p>
        <button disabled={busy} onClick={() => guard(async () => (await api.logout(), onLoggedOut()))}>
          Αποσύνδεση
        </button>
      </div>

      <div className="panel">
        <h2>Τιμολόγηση</h2>
        <p className="note">Φορολογικά στοιχεία, κατηγορίες ΦΠΑ, σειρές και κατάλογος υπηρεσιών, καθώς και τα δικά σου στοιχεία σύνδεσης με την ΑΑΔΕ.</p>
        <div className="actions">
          <a className="button" href="#/profile">
            Προφίλ επιχείρησης
          </a>
          <a className="button" href="#/aade">
            Σύνδεση με ΑΑΔΕ
          </a>
          <a className="button" href="#/clients">
            Πελάτες
          </a>
        </div>
      </div>

      <div className="panel">
        <h2>Google Calendar</h2>
        {!me.google.available ? (
          <p className="note">Η σύνδεση με Google Calendar δεν έχει ενεργοποιηθεί σε αυτή την εγκατάσταση.</p>
        ) : me.google.connected ? (
          <>
            <p>✅ Συνδεδεμένο. Τα ραντεβού που κλείνεις εδώ αντιγράφονται στο Google Calendar σου και οι ώρες που είσαι απασχολημένος εκεί εμφανίζονται ως προειδοποίηση.</p>
            <button disabled={busy} onClick={disconnect}>
              Αποσύνδεση Google
            </button>
          </>
        ) : (
          <>
            <p className="note">
              Προαιρετικό. Με τη σύνδεση, τα ραντεβού αντιγράφονται στο δικό σου Google Calendar (όνομα πελάτη και ώρα).
            </p>
            <button className="primary" disabled={busy} onClick={connect}>
              Σύνδεση με Google
            </button>
          </>
        )}
      </div>

      <div className="panel">
        <h2>Τα δεδομένα μου</h2>
        <p className="note">Ο ήχος δεν αποθηκεύεται μετά τη μεταγραφή. Στο μοντέλο ανάλυσης στέλνεται μόνο το κείμενο της εντολής.</p>
        <div className="actions">
          <a className="button" href="/api/account/export" download>
            Εξαγωγή δεδομένων
          </a>
          <a className="button" href="/privacy.html" target="_blank" rel="noopener">
            Πολιτική απορρήτου
          </a>
        </div>
        <button className="danger" disabled={busy} onClick={deleteAccount}>
          Διαγραφή λογαριασμού
        </button>
      </div>
    </section>
  );
}
