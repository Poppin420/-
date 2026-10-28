import { useEffect, useState } from "react";
import { api, ApiError, type Client } from "./api";

type Draft = { name: string; nickname: string; vat_number: string; phone: string; email: string };

const EMPTY: Draft = { name: "", nickname: "", vat_number: "", phone: "", email: "" };
const toDraft = (c: Client): Draft => ({
  name: c.name,
  nickname: c.nickname ?? "",
  vat_number: c.vat_number ?? "",
  phone: c.phone ?? "",
  email: c.email ?? "",
});

export function ClientsView() {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const load = async () => {
    try {
      setClients((await api.clients()).clients);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Σφάλμα φόρτωσης.");
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = { name: draft.name, nickname: draft.nickname, vat_number: draft.vat_number, phone: draft.phone, email: draft.email };
      if (editing === "new") await api.createClient(payload);
      else if (editing) await api.updateClient(editing, payload);
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Σφάλμα αποθήκευσης.");
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
      {field("Όνομα (όπως στην ΑΑΔΕ)", "name", { placeholder: "Γιώργος Παπαδόπουλος" })}
      {field("Χαϊδευτικό / ψευδώνυμο", "nickname", { placeholder: "Γιώργος σίδερα" })}
      {field("ΑΦΜ", "vat_number", { inputMode: "numeric", placeholder: "9 ψηφία, προαιρετικό" })}
      {field("Τηλέφωνο", "phone", { inputMode: "tel" })}
      {field("Email", "email", { type: "email" })}
      <p className="note">Το ψευδώνυμο βοηθά τη φωνητική αναγνώριση («κόψε απόδειξη στον Γιώργο σίδερα»). Στην ΑΑΔΕ στέλνεται πάντα το επίσημο όνομα.</p>
      <div className="actions">
        <button className="primary" disabled={busy || !draft.name.trim()} onClick={save}>
          Αποθήκευση
        </button>
        <button disabled={busy} onClick={() => (setEditing(null), setError(null))}>
          Άκυρο
        </button>
      </div>
    </div>
  );

  return (
    <section className="clients">
      <div className="panel">
        <h2>Πελάτες</h2>
        <p className="note">Δώσε σε κάθε πελάτη ένα χαϊδευτικό όνομα για να τον βρίσκει η φωνή πιο εύκολα.</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {editing === "new" ? (
          form
        ) : (
          <button className="primary" onClick={() => (setDraft(EMPTY), setEditing("new"))}>
            + Νέος πελάτης
          </button>
        )}
      </div>

      <div className="panel">
        {clients === null ? (
          <p className="note">Φόρτωση…</p>
        ) : clients.length === 0 ? (
          <p className="note">Δεν υπάρχουν πελάτες ακόμη. Προστίθενται αυτόματα όταν κόβεις παραστατικό ή κλείνεις ραντεβού.</p>
        ) : (
          <ul className="client-list">
            {clients.map((c) =>
              editing === c.id ? (
                <li key={c.id}>{form}</li>
              ) : (
                <li key={c.id} className="list-item">
                  <div className="client-row">
                    <div>
                      <strong>{c.name}</strong>
                      {c.nickname && <span className="nickname"> «{c.nickname}»</span>}
                      <div className="note">{[c.vat_number && `ΑΦΜ ${c.vat_number}`, c.phone, c.email].filter(Boolean).join(" · ")}</div>
                    </div>
                    <button onClick={() => (setDraft(toDraft(c)), setEditing(c.id))}>Επεξεργασία</button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    </section>
  );
}
