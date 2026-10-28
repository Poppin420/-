import { useState } from "react";
import { api, ApiError } from "./api";

export function AuthScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await api.login(email, password);
      else await api.signup(email, password, code);
      onSignedIn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Σφάλμα.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app narrow">
      <h1>{mode === "login" ? "Σύνδεση" : "Εγγραφή"}</h1>
      <form className="auth" onSubmit={submit}>
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Κωδικός
          <input
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={mode === "signup" ? 10 : undefined}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {mode === "signup" && (
          <label>
            Κωδικός πρόσκλησης
            <input required value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" type="submit" disabled={busy}>
          {mode === "login" ? "Είσοδος" : "Δημιουργία λογαριασμού"}
        </button>
      </form>
      <button className="link" onClick={() => (setMode(mode === "login" ? "signup" : "login"), setError(null))}>
        {mode === "login" ? "Δεν έχεις λογαριασμό; Εγγραφή" : "Έχεις λογαριασμό; Σύνδεση"}
      </button>
      <p className="note">
        Με τη χρήση αποδέχεσαι την <a href="/privacy.html">πολιτική απορρήτου</a>.
      </p>
    </main>
  );
}
