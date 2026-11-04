import { useMemo, useState } from "react";
import { api, ApiError } from "./api";

/** The fields a row can map to. Order is the order shown in the mapping UI. */
const FIELDS = [
  ["name", "Όνομα πελάτη"],
  ["plate", "Πινακίδα"],
  ["make", "Μάρκα"],
  ["model", "Μοντέλο"],
  ["engine", "Κυβικά / κινητήρας"],
  ["year", "Έτος"],
  ["vin", "Αρ. πλαισίου (VIN)"],
  ["vat_number", "ΑΦΜ"],
  ["phone", "Τηλέφωνο"],
  ["email", "Email"],
  ["nickname", "Χαϊδευτικό"],
  ["notes", "Σημειώσεις"],
] as const;
type Field = (typeof FIELDS)[number][0];

// Keywords (accent-free, lowercase) that hint a header maps to a field.
const HINTS: Record<Field, string[]> = {
  name: ["ονομα", "ονοματεπωνυμο", "πελατης", "πελατη", "name", "επωνυμια"],
  plate: ["πινακιδα", "αριθμος κυκλοφοριας", "αρ κυκλοφοριας", "plate", "κυκλοφορια"],
  make: ["μαρκα", "make", "brand", "κατασκευαστης"],
  model: ["μοντελο", "τυπος", "model"],
  engine: ["κυβικα", "κινητηρας", "cc", "engine"],
  year: ["ετος", "χρονολογια", "year", "μοντελο ετος"],
  vin: ["πλαισιο", "vin", "αρ πλαισιου", "chassis"],
  vat_number: ["αφμ", "vat"],
  phone: ["τηλεφωνο", "τηλ", "phone", "κινητο"],
  email: ["email", "mail", "ηλεκτρονικο"],
  nickname: ["χαιδευτικο", "ψευδωνυμο", "nickname"],
  notes: ["παρατηρησεις", "σχολια", "σημειωσεις", "notes"],
};

const deaccent = (x: string) =>
  x
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

/** Splits one CSV line, honoring quotes and the chosen delimiter. */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) {
      if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) (out.push(cur), (cur = ""));
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

interface Parsed {
  headers: string[];
  rows: string[][];
}

function parseCsv(text: string): Parsed | null {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;
  // Guess the delimiter from the header line.
  const delim = (lines[0]!.match(/;/g)?.length ?? 0) > (lines[0]!.match(/,/g)?.length ?? 0) ? ";" : ",";
  const headers = splitLine(lines[0]!, delim);
  const rows = lines.slice(1).map((l) => splitLine(l, delim));
  return { headers, rows };
}

function autoMap(headers: string[]): Record<Field, number> {
  const map = {} as Record<Field, number>;
  for (const [field] of FIELDS) {
    map[field] = -1;
    const idx = headers.findIndex((h) => HINTS[field].some((kw) => deaccent(h).includes(kw)));
    if (idx >= 0) map[field] = idx;
  }
  return map;
}

export function GarageImportView() {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [map, setMap] = useState<Record<Field, number>>({} as Record<Field, number>);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);

  const onFile = async (file: File) => {
    setError(null);
    setSummary(null);
    const text = await file.text();
    const p = parseCsv(text);
    if (!p) {
      setError("Δεν βρέθηκαν γραμμές. Χρειάζεται αρχείο CSV με επικεφαλίδες και τουλάχιστον μία γραμμή.");
      setParsed(null);
      return;
    }
    setParsed(p);
    setMap(autoMap(p.headers));
  };

  const rows = useMemo(() => {
    if (!parsed) return [];
    return parsed.rows.map((cells) => {
      const row: Record<string, string> = {};
      for (const [field] of FIELDS) {
        const idx = map[field];
        if (idx >= 0 && cells[idx]) row[field] = cells[idx]!;
      }
      return row;
    });
  }, [parsed, map]);

  const importable = rows.filter((r) => r.name || r.plate).length;

  const doImport = async () => {
    setBusy(true);
    setError(null);
    try {
      const { summary } = await api.importGarage(rows);
      setSummary(summary as unknown as Record<string, number>);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Σφάλμα εισαγωγής.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="import-view">
      <div className="panel">
        <h2>Εισαγωγή από το πρόγραμμά σου</h2>
        <p className="note">
          Βγάλε τα δεδομένα σου σε αρχείο CSV (π.χ. από την Access: δεξί κλικ στον πίνακα → Export → Text/CSV) και ανέβασέ το εδώ. Κάθε γραμμή
          είναι ένα αυτοκίνητο· οι πελάτες ενοποιούνται αυτόματα. <strong>Δεν στέλνεται τίποτα στην ΑΑΔΕ</strong> — γεμίζει μόνο η δική σου λίστα
          πελατών και οχημάτων.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </div>

      {parsed && !summary && (
        <>
          <div className="panel">
            <h3>Αντιστοίχιση στηλών</h3>
            <p className="note">Διάλεξε ποια στήλη του αρχείου σου αντιστοιχεί σε κάθε πεδίο. Ό,τι αφήσεις «—» αγνοείται.</p>
            <div className="form-grid">
              {FIELDS.map(([field, label]) => (
                <label key={field}>
                  {label}
                  <select value={map[field] ?? -1} onChange={(e) => setMap({ ...map, [field]: Number(e.target.value) })}>
                    <option value={-1}>—</option>
                    {parsed.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Στήλη ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <div className="panel">
            <p>
              Βρέθηκαν <strong>{parsed.rows.length}</strong> γραμμές, θα εισαχθούν <strong>{importable}</strong> (όσες έχουν όνομα ή πινακίδα).
            </p>
            <div className="actions">
              <button className="primary" disabled={busy || importable === 0} onClick={doImport}>
                {busy ? "Εισαγωγή…" : `Εισαγωγή ${importable} εγγραφών`}
              </button>
            </div>
          </div>
        </>
      )}

      {summary && (
        <div className="panel">
          <h3>Έτοιμο ✅</h3>
          <ul>
            <li>Νέοι πελάτες: {summary.clientsCreated}</li>
            <li>Νέα οχήματα: {summary.vehiclesCreated}</li>
            <li>Οχήματα που υπήρχαν ήδη: {summary.vehiclesSkipped}</li>
            <li>Γραμμές που παραλείφθηκαν: {summary.rowsSkipped}</li>
          </ul>
          <a className="button" href="#/clients">
            Δες τους πελάτες
          </a>
        </div>
      )}
    </section>
  );
}
