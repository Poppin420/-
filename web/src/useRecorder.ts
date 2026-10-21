import { useCallback, useEffect, useRef, useState } from "react";

export const MAX_RECORDING_SECONDS = 60;

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
}

export type RecorderState = "idle" | "recording" | "unsupported";

/** Tap-to-start / tap-to-stop recorder. Audio stays in memory and is handed to `onDone`. */
export function useRecorder(onDone: (audio: Blob) => void, onError: (message: string) => void) {
  const [state, setState] = useState<RecorderState>(
    typeof navigator !== "undefined" && navigator.mediaDevices && typeof MediaRecorder !== "undefined" ? "idle" : "unsupported",
  );
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    recorder.current?.stream.getTracks().forEach((t) => t.stop());
    recorder.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      onError("Δεν δόθηκε άδεια για το μικρόφωνο. Ενεργοποίησέ τη από τις ρυθμίσεις του browser.");
      return;
    }
    const mimeType = pickMime();
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType || mimeType || "audio/webm" });
      cleanup();
      setState("idle");
      if (blob.size > 0) onDone(blob);
    };
    recorder.current = rec;
    rec.start();
    setSeconds(0);
    setState("recording");
    const started = Date.now();
    timer.current = window.setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      setSeconds(s);
      if (s >= MAX_RECORDING_SECONDS) stop();
    }, 250);
  }, [cleanup, onDone, onError, stop]);

  return { state, seconds, start, stop };
}
