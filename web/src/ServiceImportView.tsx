import { useMemo, useState } from "react";
import { api, ApiError } from "./api";

// Fields a column can map to, with Greek header hints (accent-free, lowercase).
const FIELDS = [
  ["plate", "Πινακίδα", ["πινακιδα", "αριθμος", "plate"]],
  ["serviced_on", "Ημερομηνία", ["ημερομηνια", "date"]],
  ["odometer", "Χιλιόμετρα", ["χιλιομετρ", "km", "odometer"]],
  ["work_type", "Είδος εργασίας", ["ειδος", "εργασ", "work"]],
  ["items", "Εργασίες (checklist)", ["εργασιες", "checklist", "items"]],
  ["notes", "Σημειώσεις", ["σημειωσ", "παρατηρησ", "βλαβ", "notes"]],
] as const;
type Field = (typeof FIELDS)[number][0];

const deaccent = (x: string) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

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

export function ServiceImportView() {
  const [headers, setHeaders] = useState<string[]>([]);
  const [data, setData] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<Field, number>>({} as Record<Field, number>);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);

  const onFile = async (file: File) => {
    setError(null);
    setSummary(null);
    const text = (await file.text()).replace(/\r\n?/g, "\n");
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length < 2) {
      setError("Χρειάζεται αρχείο CSV με επικεφαλίδες και τουλάχιστον μία γραμμή.");
      return;
    }
    const delim = (lines[0]!.match(/;/g)?.length ?? 0) > (lines[0]!.match(/,/g)?.length ?? 0) ? ";" : ",";
    const hs = splitLine(lines[0]!, delim);
    setHeaders(hs);
    setData(lines.slice(1).map((l) => splitLine(l, delim)));
    const m = {} as Record<Field, number>;
    for (const [field, , hints] of FIELDS) {
      m[field] = hs.findIndex((h) => hints.some((kw) => deaccent(h).includes(kw)));
    }
    setMap(m);
  };

  const rows = useMemo(() => {
    if (headers.length === 0) return [];
    return data.map((cells) => {
      const row: Record<string, string> = {};
      for (const [field] of FIELDS) {
        const idx = map[field];
        if (idx >= 0 && cells[idx]) row[field] = cells[idx]!;
      }
      return row;
    });
  }, [data, headers, map]);

  const importable = rows.filter((r) => r.plate).length;

  const doImport = async () => {
    setBusy(true);
    setError(null);
    try {
      const { summary } = await api.importServiceHistory(rows);
      setSummary(summary);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Σφάλμα εισαγωγής.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="import-view">
      <div className="panel">
        <h2>Εισαγωγή ιστορικού service</h2>
        <p className="note">
          Ανέβασε το CSV με τις παλιές επισκευές. Κάθε γραμμή μπαίνει στο ιστορικό του αμαξιού με την <strong>πινακίδα</strong>.{" "}
          <strong>Κάνε πρώτα την εισαγωγή πελατών/οχημάτων</strong>, αλλιώς δεν θα βρεθούν τα αμάξια.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </div>

      {headers.length > 0 && !summary && (
        <>
          <div className="panel">
            <h3>Αντιστοίχιση στηλών</h3>
            <div className="form-grid">
              {FIELDS.map(([field, label]) => (
                <label key={field}>
                  {label}
                  <select value={map[field] ?? -1} onChange={(e) => setMap({ ...map, [field]: Number(e.target.value) })}>
                    <option value={-1}>—</option>
                    {headers.map((h, i) => (
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
              Βρέθηκαν <strong>{data.length}</strong> γραμμές, θα εισαχθούν <strong>{importable}</strong> (όσες έχουν πινακίδα).
            </p>
            <div className="actions">
              <button className="primary" disabled={busy || importable === 0} onClick={doImport}>
                {busy ? "Εισαγωγή…" : `Εισαγωγή ${importable} επισκευών`}
              </button>
            </div>
          </div>
        </>
      )}

      {summary && (
        <div className="panel">
          <h3>Έτοιμο ✅</h3>
          <ul>
            <li>Μπήκαν στο ιστορικό: {summary.created}</li>
            <li>Παραλείφθηκαν (δεν βρέθηκε αμάξι με αυτή την πινακίδα): {summary.skippedNoVehicle}</li>
          </ul>
          <a className="button" href="#/history">
            Δες το ιστορικό
          </a>
        </div>
      )}
    </section>
  );
}
