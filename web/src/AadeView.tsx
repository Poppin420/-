import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type CredentialStatus, type SpecInfo } from "./api";

type Env = "test" | "prod";

export function AadeView() {
  const [creds, setCreds] = useState<Record<Env, CredentialStatus> | null>(null);
  const [spec, setSpec] = useState<SpecInfo | null>(null);
  const [encryption, setEncryption] = useState(true);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.aadeCredentials();
      setCreds(r.credentials);
      setSpec(r.spec);
      setEncryption(r.encryptionConfigured);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : "Σφάλμα φόρτωσης." });
    }
  }, []);
  useEffect(() => void load(), [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMessage(null);
    try {
      await fn();
      setMessage({ ok: true, text: ok });
      await load();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : "Σφάλμα." });
    }
  };

  return (
    <section className="settings">
      <a className="link" href="#/settings">
        ‹ Ρυθμίσεις
      </a>
      <div className="panel">
        <h2>Σύνδεση με ΑΑΔΕ (myDATA)</h2>
        <p>
          Κάθε επιχείρηση συνδέεται με <strong>τα δικά της</strong> στοιχεία πρόσβασης στο myDATA REST API. Τα στοιχεία
          αποθηκεύονται κρυπτογραφημένα, δεν εμφανίζονται ξανά, δεν στέλνονται στο μοντέλο ανάλυσης και μπορείς να τα
          διαγράψεις όποτε θέλεις.
        </p>
        <ol className="steps">
          <li>Μπες στην πλατφόρμα myDATA της ΑΑΔΕ με τους κωδικούς TAXISnet της επιχείρησης.</li>
          <li>Κάνε εγγραφή χρήστη για το REST API. Θα πάρεις <em>όνομα χρήστη</em> και <em>subscription key</em>.</li>
          <li>Για το δοκιμαστικό περιβάλλον (sandbox) χρειάζεται ξεχωριστή εγγραφή, με ξεχωριστά στοιχεία.</li>
        </ol>
        <p className="note">
          Τα ακριβή βήματα και οι σύνδεσμοι θα συμπληρωθούν από την επίσημη τεκμηρίωση της ΑΑΔΕ.
        </p>
        {spec && !spec.verified && (
          <p className="notice">
            Η επίσημη προδιαγραφή myDATA δεν έχει φορτωθεί ακόμη. Μπορείς να αποθηκεύσεις τα στοιχεία, αλλά η δοκιμή
            σύνδεσης και η έκδοση παραστατικών είναι κλειδωμένες.
          </p>
        )}
        {!encryption && <p className="error">Η κρυπτογράφηση δεν έχει ρυθμιστεί στον server. Τα στοιχεία δεν μπορούν να αποθηκευτούν.</p>}
        {message && <p className={message.ok ? "note ok-note" : "error"}>{message.text}</p>}
      </div>

      {creds && (
        <>
          <CredentialForm env="test" status={creds.test} onSave={(u, k) => act(() => api.saveAadeCredentials("test", u, k), "Αποθηκεύτηκαν τα δοκιμαστικά στοιχεία.")}
            onDelete={() => act(() => api.deleteAadeCredentials("test"), "Διαγράφηκαν.")} onTest={() => act(() => api.testAade("test"), "Η σύνδεση πέτυχε.")} />
          <CredentialForm env="prod" status={creds.prod} onSave={(u, k) => act(() => api.saveAadeCredentials("prod", u, k, true), "Αποθηκεύτηκαν τα στοιχεία παραγωγής.")}
            onDelete={() => act(() => api.deleteAadeCredentials("prod"), "Διαγράφηκαν.")} onTest={() => act(() => api.testAade("prod"), "Η σύνδεση πέτυχε.")} />
        </>
      )}
    </section>
  );
}

function CredentialForm(props: {
  env: Env;
  status: CredentialStatus;
  onSave: (username: string, key: string) => void;
  onDelete: () => void;
  onTest: () => void;
}) {
  const [username, setUsername] = useState("");
  const [key, setKey] = useState("");
  const [understood, setUnderstood] = useState(false);
  const prod = props.env === "prod";

  return (
    <div className="panel">
      <h2>
        {prod ? "Πραγματικό περιβάλλον" : "Δοκιμαστικό περιβάλλον (προεπιλογή)"}{" "}
        <span className={`env ${prod ? "prod" : "test"}`}>{prod ? "ΠΡΑΓΜΑΤΙΚΟ" : "ΔΟΚΙΜΑΣΤΙΚΟ"}</span>
      </h2>
      {prod && (
        <p className="error">
          ⚠️ Στο πραγματικό περιβάλλον τα παραστατικά είναι <strong>επίσημα και δεσμευτικά</strong>. Ενεργοποιείται μόνο
          στη φάση (δ), αφού περάσουν όλοι οι έλεγχοι στο δοκιμαστικό και επιβεβαιωθούν οι φορολογικοί κανόνες από
          λογιστή.
        </p>
      )}
      <p>{props.status.configured ? `Αποθηκευμένα: χρήστης ${props.status.usernameHint}` : "Δεν έχουν οριστεί στοιχεία."}</p>
      <form
        className="auth"
        onSubmit={(e) => {
          e.preventDefault();
          props.onSave(username, key);
          setKey("");
        }}
      >
        <label>
          Όνομα χρήστη
          <input autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        <label>
          Subscription key
          <input type="password" autoComplete="new-password" value={key} onChange={(e) => setKey(e.target.value)} required minLength={8} />
        </label>
        {prod && (
          <label className="check">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
            Κατανοώ ότι πρόκειται για το πραγματικό περιβάλλον της ΑΑΔΕ.
          </label>
        )}
        <button className="primary" type="submit" disabled={prod && !understood}>
          Αποθήκευση
        </button>
      </form>
      {props.status.configured && (
        <div className="actions">
          <button onClick={props.onTest}>Δοκιμή σύνδεσης</button>
          <button className="danger" onClick={() => window.confirm("Διαγραφή των στοιχείων;") && props.onDelete()}>
            Διαγραφή στοιχείων
          </button>
        </div>
      )}
    </div>
  );
}
