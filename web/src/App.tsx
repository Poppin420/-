import { useCallback, useState } from "react";
import type { ActionCard } from "@core/intent-parsing/resolve";
import { answerQuestion } from "@core/intent-parsing/resolve";
import { ActionCardView, type CardStatus } from "./ActionCardView";
import { ApiError, loadToken, saveToken, sendText, sendVoice } from "./api";
import { MAX_RECORDING_SECONDS, useRecorder } from "./useRecorder";

type Busy = null | "transcribing" | "parsing";

export function App() {
  const [token, setToken] = useState(loadToken);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  // The text the cards were extracted from; span checks must use this, not later edits.
  const [parsedTranscript, setParsedTranscript] = useState("");
  const [cards, setCards] = useState<ActionCard[]>([]);
  const [statuses, setStatuses] = useState<Record<string, CardStatus>>({});
  const [unrecognized, setUnrecognized] = useState<string[]>([]);
  const [hasResult, setHasResult] = useState(false);

  const applyResult = useCallback((r: { transcript: string; cards: ActionCard[]; unrecognized: string[] }) => {
    setTranscript(r.transcript);
    setParsedTranscript(r.transcript);
    setCards(r.cards);
    setStatuses({});
    setUnrecognized(r.unrecognized);
    setHasResult(true);
  }, []);

  const handleFailure = useCallback((e: unknown) => {
    if (e instanceof ApiError) {
      setError(e.message);
      if (e.transcript) setTranscript(e.transcript);
      if (e.status === 401) setToken("");
    } else {
      setError("Δεν υπάρχει σύνδεση με τον server. Έλεγξε το δίκτυο.");
    }
  }, []);

  const onAudio = useCallback(
    async (audio: Blob) => {
      setBusy("transcribing");
      setError(null);
      try {
        applyResult(await sendVoice(audio, token));
      } catch (e) {
        handleFailure(e);
      } finally {
        setBusy(null);
      }
    },
    [applyResult, handleFailure, token],
  );

  const recorder = useRecorder(onAudio, setError);

  const reparse = async () => {
    if (!transcript.trim()) return;
    setBusy("parsing");
    setError(null);
    try {
      applyResult(await sendText(transcript, token));
    } catch (e) {
      handleFailure(e);
    } finally {
      setBusy(null);
    }
  };

  const updateCard = (id: string, fn: (c: ActionCard) => ActionCard) =>
    setCards((cs) => cs.map((c) => (c.id === id ? fn(c) : c)));

  if (!token) return <TokenScreen onSave={(t) => (saveToken(t), setToken(t))} />;

  const recording = recorder.state === "recording";

  return (
    <main className="app">
      <header className="top">
        <h1>Βοηθός</h1>
        <span className="env test">ΔΟΚΙΜΑΣΤΙΚΟ</span>
      </header>

      <section className="mic-area">
        {recorder.state === "unsupported" ? (
          <p className="error">Ο browser δεν υποστηρίζει ηχογράφηση. Γράψε την εντολή παρακάτω.</p>
        ) : (
          <button
            className={`mic ${recording ? "recording" : ""}`}
            disabled={busy !== null}
            onClick={() => (recording ? recorder.stop() : recorder.start())}
            aria-label={recording ? "Τέλος ηχογράφησης" : "Έναρξη ηχογράφησης"}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {recording ? (
                <rect x="6" y="6" width="12" height="12" rx="2" />
              ) : (
                <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
              )}
            </svg>
          </button>
        )}
        <p className="hint">
          {busy === "transcribing"
            ? "Μεταγραφή…"
            : busy === "parsing"
              ? "Ανάλυση…"
              : recording
                ? `Ηχογράφηση ${recorder.seconds}″ / ${MAX_RECORDING_SECONDS}″ · πάτα ξανά για τέλος`
                : "Πάτα και μίλα. Π.χ. «Κλείσε ραντεβού με τη Μαρία αύριο στις 5 το απόγευμα»"}
        </p>
      </section>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {(hasResult || transcript) && (
        <section className="transcript">
          <label htmlFor="transcript">Τι κατάλαβα (μπορείς να το διορθώσεις):</label>
          <textarea id="transcript" value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={3} />
          <button onClick={reparse} disabled={busy !== null || !transcript.trim()}>
            Ανάλυση ξανά
          </button>
        </section>
      )}

      {hasResult && cards.length === 0 && <p className="note">Δεν βρήκα κάποια ενέργεια στην εντολή.</p>}
      {unrecognized.length > 0 && (
        <p className="note">Δεν κατάλαβα: {unrecognized.map((u) => `«${u}»`).join(", ")}</p>
      )}

      <section className="cards">
        {cards.map((card) => (
          <ActionCardView
            key={card.id}
            card={card}
            status={statuses[card.id] ?? "pending"}
            onAnswer={(field, value) => updateCard(card.id, (c) => answerQuestion(c, field, value, parsedTranscript, new Date()))}
            onConfirm={() => setStatuses((s) => ({ ...s, [card.id]: "confirmed" }))}
            onDiscard={() => setStatuses((s) => ({ ...s, [card.id]: "discarded" }))}
          />
        ))}
      </section>

      <footer className="foot">
        <button className="link" onClick={() => (saveToken(""), setToken(""))}>
          Αποσύνδεση
        </button>
        <span>Ο ήχος δεν αποθηκεύεται μετά τη μεταγραφή.</span>
      </footer>
    </main>
  );
}

function TokenScreen({ onSave }: { onSave: (token: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <main className="app narrow">
      <h1>Σύνδεση</h1>
      <p>
        Προσωρινή πρόσβαση για τη δοκιμαστική φάση: βάλε τον κωδικό πρόσβασης της εγκατάστασης. Κανονικοί λογαριασμοί
        χρηστών έρχονται στη φάση (β).
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSave(value.trim());
        }}
      >
        <input type="password" autoComplete="current-password" value={value} onChange={(e) => setValue(e.target.value)} />
        <button className="primary" type="submit">
          Είσοδος
        </button>
      </form>
    </main>
  );
}
