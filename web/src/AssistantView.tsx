import { useCallback, useState } from "react";
import { ActionCardView, type CardState } from "./ActionCardView";
import { api, ApiError, type CardPreview, type Choices, type CommandResponse } from "./api";
import { MAX_RECORDING_SECONDS, useRecorder } from "./useRecorder";

type Busy = null | "transcribing" | "parsing";

export function AssistantView() {
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  // The text the cards were extracted from; the server re-checks spans against it.
  const [parsedTranscript, setParsedTranscript] = useState("");
  const [cards, setCards] = useState<CardState[]>([]);
  const [unrecognized, setUnrecognized] = useState<string[]>([]);
  const [hasResult, setHasResult] = useState(false);

  const applyResult = useCallback((r: CommandResponse) => {
    setTranscript(r.transcript);
    setParsedTranscript(r.transcript);
    setCards(r.previews.map((preview) => ({ preview, choices: {}, status: "pending", message: null, error: null })));
    setUnrecognized(r.unrecognized);
    setHasResult(true);
  }, []);

  const fail = useCallback((e: unknown) => {
    setError(e instanceof ApiError ? e.message : "Κάτι πήγε στραβά. Δοκίμασε ξανά.");
    if (e instanceof ApiError && typeof e.body.transcript === "string") setTranscript(e.body.transcript);
  }, []);

  const run = useCallback(
    async (kind: Exclude<Busy, null>, fn: () => Promise<CommandResponse>) => {
      setBusy(kind);
      setError(null);
      try {
        applyResult(await fn());
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
      }
    },
    [applyResult, fail],
  );

  const recorder = useRecorder((audio) => run("transcribing", () => api.voice(audio)), setError);

  const update = (id: string, patch: Partial<CardState>) =>
    setCards((cs) => cs.map((c) => (c.preview.card.id === id ? { ...c, ...patch } : c)));

  const refresh = async (state: CardState, choices: Choices, answer?: { field: string; value: string }) => {
    const id = state.preview.card.id;
    update(id, { status: "busy", error: null, choices });
    try {
      const preview = await api.preview(state.preview, parsedTranscript, choices, answer);
      update(id, { preview, status: "pending" });
    } catch (e) {
      update(id, { status: "pending", error: e instanceof ApiError ? e.message : "Σφάλμα." });
    }
  };

  const confirm = async (state: CardState) => {
    const id = state.preview.card.id;
    update(id, { status: "busy", error: null });
    try {
      const result = await api.execute(state.preview, parsedTranscript, state.choices);
      update(id, { status: "done", message: result.message });
    } catch (e) {
      const preview = e instanceof ApiError ? (e.body.preview as CardPreview | undefined) : undefined;
      update(id, {
        status: "pending",
        error: e instanceof ApiError ? e.message : "Σφάλμα.",
        ...(preview ? { preview } : {}),
      });
    }
  };

  const recording = recorder.state === "recording";

  return (
    <>
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

      <section className="transcript">
        <label htmlFor="transcript">{hasResult ? "Τι κατάλαβα (μπορείς να το διορθώσεις):" : "Ή γράψε την εντολή:"}</label>
        <textarea id="transcript" value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={3} />
        <button onClick={() => run("parsing", () => api.parse(transcript))} disabled={busy !== null || !transcript.trim()}>
          {hasResult ? "Ανάλυση ξανά" : "Ανάλυση"}
        </button>
      </section>

      {hasResult && cards.length === 0 && <p className="note">Δεν βρήκα κάποια ενέργεια στην εντολή.</p>}
      {unrecognized.length > 0 && <p className="note">Δεν κατάλαβα: {unrecognized.map((u) => `«${u}»`).join(", ")}</p>}

      <section className="cards">
        {cards.map((state) => (
          <ActionCardView
            key={state.preview.card.id}
            state={state}
            onAnswer={(field, value) => refresh(state, state.choices, { field, value })}
            onChoose={(choices) => refresh(state, choices)}
            onConfirm={() => confirm(state)}
            onDiscard={() => update(state.preview.card.id, { status: "discarded" })}
          />
        ))}
      </section>
    </>
  );
}
