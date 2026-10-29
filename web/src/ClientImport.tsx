import { useState } from "react";
import { api, ApiError } from "./api";

type Field = "name" | "vat_number" | "phone" | "plate" | "nickname" | "email";

const FIELDS: Array<{ key: Field; label: string }> = [
  { key: "name", label: "Όνομα *" },
  { key: "vat_number", label: "ΑΦΜ" },
  { key: "phone", label: "Τηλέφωνο" },
  { key: "plate", label: "Πινακίδα" },
  { key: "nickname", label: "Ψευδώνυμο" },
  { key: "email", label: "Email" },
];

const HINTS: Record<Field, string[]> = {
  name: ["ονομα", "name", "επωνυμ", "πελατ", "ονοματεπων"],
  vat_number: ["αφμ", "vat", "αφ.μ"],
  phone: ["τηλ", "phone", "κινητ", "mobile"],
  plate: ["πινακ", "plate", "κυκλοφορ", "αρ.κυκλ"],
  nickname: ["ψευδων", "nickname", "χαιδευτ", "παρατσουκλ"],
  email: ["email", "mail"],
};

const normalize = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "");

function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/)[0] ?? "";
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  for (const ch of line) if (ch in counts) counts[ch]!++;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0];
}

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const clean = text.replace(/^﻿/, "");
  const delimiter = detectDelimiter(clean);
  const records: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); records.push(row); field = ""; row = []; }
    else if (ch !== "\r") field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); records.push(row); }
  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ""));
  const headers = (nonEmpty.shift() ?? []).map((h) => h.trim());
  return { headers, rows: nonEmpty };
}

function autoMap(headers: string[]): Partial<Record<Field, number>> {
  const map: Partial<Record<Field, number>> = {};
  headers.forEach((h, i) => {
    const n = normalize(h);
    for (const [field, hints] of Object.entries(HINTS) as Array<[Field, string[]]>) {
      if (map[field] === undefined && hints.some((x) => n.includes(normalize(x)))) map[field] = i;
    }
  });
  return map;
}

export function ClientImport({ onDone }: { onDone: () => void }) {
  const [headers, setHeaders] = useState<string[] | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [map, setMap] = useState<Partial<Record<Field, number>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);

  const onFile = async (file: File) => {
    setError(null);
    setResult(null);
    try {
      const { headers, rows } = parseCsv(await file.text());
      if (headers.length === 0) {
        setError("Το αρχείο δεν έχει στήλες.");
        return;
      }
      setHeaders(headers);
      setRows(rows);
      setMap(autoMap(headers));
    } catch {
      setError("Δεν διάβασα το αρχείο. Στείλε CSV (από Excel: Αποθήκευση ως → CSV).");
    }
  };

  const cell = (row: string[], f: Field): string => {
    const i = map[f];
    return i === undefined ? "" : (row[i] ?? "").trim();
  };
  const ready = rows.filter((r) => map.name !== undefined && cell(r, "name") !== "");

  const doImport = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = ready.map((r) => ({
        name: cell(r, "name"),
        vat_number: cell(r, "vat_number") || null,
        phone: cell(r, "phone") || null,
        plate: cell(r, "plate") || null,
        nickname: cell(r, "nickname") || null,
        email: cell(r, "email") || null,
      }));
      const res = await api.importClients(payload);
      setResult(res);
      setHeaders(null);
      setRows([]);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Η εισαγωγή απέτυχε.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="list-item import">
      <p className="note">
        Ανέβασε αρχείο <strong>CSV</strong> (από Excel: «Αποθήκευση ως → CSV»). Αντιστοίχισε τις στήλες και κάνε εισαγωγή. Δεν στέλνεται τίποτα στην ΑΑΔΕ.
      </p>
      <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
      {error && <p className="error" role="alert">{error}</p>}
      {result && (
        <p className="note ok-note">
          Εισήχθησαν {result.imported}, παραλείφθηκαν {result.skipped}.
          {result.errors.length > 0 && <> ({result.errors.join("· ")})</>}
        </p>
      )}

      {headers && (
        <>
          <div className="form-grid">
            {FIELDS.map(({ key, label }) => (
              <label key={key}>
                {label}
                <select
                  value={map[key] ?? ""}
                  onChange={(e) => setMap({ ...map, [key]: e.target.value === "" ? undefined : Number(e.target.value) })}
                >
                  <option value="">— καμία στήλη —</option>
                  {headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Στήλη ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <p className="note">{ready.length} από {rows.length} γραμμές έχουν όνομα και θα εισαχθούν.</p>
          <div className="actions">
            <button className="primary" disabled={busy || map.name === undefined || ready.length === 0} onClick={doImport}>
              Εισαγωγή {ready.length} πελατών
            </button>
            <button disabled={busy} onClick={() => (setHeaders(null), setRows([]), setError(null))}>
              Άκυρο
            </button>
          </div>
        </>
      )}
    </div>
  );
}
