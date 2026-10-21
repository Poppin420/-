import { useState } from "react";
import { DateTime } from "luxon";
import type { ActionCard, ResolvedFields } from "@core/intent-parsing/resolve";
import { formatDate, formatEuro } from "@core/intent-parsing/resolve";

export type CardStatus = "pending" | "confirmed" | "discarded";

interface Props {
  card: ActionCard;
  status: CardStatus;
  onAnswer: (field: string, value: string) => void;
  onConfirm: () => void;
  onDiscard: () => void;
}

const TITLES: Record<ActionCard["type"], string> = {
  create_appointment: "Νέο ραντεβού",
  reschedule_appointment: "Μετακίνηση ραντεβού",
  cancel_appointment: "Ακύρωση ραντεβού",
  query_calendar: "Πρόγραμμα",
  create_invoice: "Προσχέδιο παραστατικού",
  create_client: "Νέος πελάτης",
};

const CONFIRMED_NOTE: Record<ActionCard["type"], string> = {
  create_appointment: "Επιβεβαιώθηκε. Η καταχώριση στο ημερολόγιο ενεργοποιείται στη φάση (β).",
  reschedule_appointment: "Επιβεβαιώθηκε. Η μετακίνηση ενεργοποιείται στη φάση (β).",
  cancel_appointment: "Επιβεβαιώθηκε. Η ακύρωση ενεργοποιείται στη φάση (β).",
  query_calendar: "Η προβολή του προγράμματος ενεργοποιείται στη φάση (β).",
  create_invoice: "Το προσχέδιο κρατήθηκε. Η έκδοση (με ΦΠΑ, σύνολα και κουμπί «Έκδοση») έρχεται στη φάση (γ).",
  create_client: "Επιβεβαιώθηκε. Η αποθήκευση πελατών ενεργοποιείται στη φάση (β).",
};

export function ActionCardView({ card, status, onAnswer, onConfirm, onDiscard }: Props) {
  const [editing, setEditing] = useState(false);
  const rows = fieldRows(card.fields);
  const done = status !== "pending";

  return (
    <article className={`card card-${status}`} aria-label={TITLES[card.type]}>
      <header className="card-head">
        <h3>{TITLES[card.type]}</h3>
        {status === "confirmed" && <span className="badge ok">Επιβεβαιωμένο</span>}
        {status === "discarded" && <span className="badge muted">Απορρίφθηκε</span>}
      </header>

      {card.type === "create_invoice" && !done && (
        <p className="notice">
          Προσχέδιο. ΦΠΑ, σύνολα, τύπος και αρίθμηση παραστατικού υπολογίζονται από το σύστημα στη φάση (γ), όχι από
          το LLM.
        </p>
      )}

      <dl className="fields">
        {rows.map(([label, value]) => (
          <div key={label} className="row">
            <dt>{label}</dt>
            <dd className={value ? "" : "missing"}>{value ?? "—"}</dd>
          </div>
        ))}
      </dl>

      {card.assumptions.length > 0 && !done && (
        <ul className="assumptions">
          {card.assumptions.map((a) => (
            <li key={a.field + a.message}>⚠️ {a.message}</li>
          ))}
        </ul>
      )}

      {!done &&
        card.questions.map((q) => <QuestionView key={q.field} question={q} onAnswer={(v) => onAnswer(q.field, v)} />)}

      {!done && editing && <EditForm card={card} onSubmit={(f, v) => (onAnswer(f, v), setEditing(false))} />}

      {done ? (
        status === "confirmed" && <p className="note">{CONFIRMED_NOTE[card.type]}</p>
      ) : (
        <div className="actions">
          <button className="primary" disabled={!card.ready} onClick={onConfirm}>
            {card.type === "create_invoice" ? "Αποδοχή προσχεδίου" : "Επιβεβαίωση"}
          </button>
          <button onClick={() => setEditing((e) => !e)}>{editing ? "Κλείσιμο" : "Διόρθωση"}</button>
          <button className="danger" onClick={onDiscard}>
            Απόρριψη
          </button>
        </div>
      )}
    </article>
  );
}

function QuestionView({
  question,
  onAnswer,
}: {
  question: ActionCard["questions"][number];
  onAnswer: (value: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <div className="question">
      <p>❓ {question.message}</p>
      {question.options && (
        <div className="options">
          {question.options.map((o) => (
            <button key={o.value} onClick={() => onAnswer(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
      )}
      <form
        className="answer"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) onAnswer(text);
          setText("");
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Γράψε την απάντηση" />
        <button type="submit">OK</button>
      </form>
    </div>
  );
}

function EditForm({ card, onSubmit }: { card: ActionCard; onSubmit: (field: string, value: string) => void }) {
  const fields = editableFields(card);
  const [field, setField] = useState(fields[0]?.[0] ?? "");
  const [value, setValue] = useState("");
  return (
    <form
      className="edit"
      onSubmit={(e) => {
        e.preventDefault();
        if (field) onSubmit(field, value);
      }}
    >
      <select value={field} onChange={(e) => setField(e.target.value)}>
        {fields.map(([path, label]) => (
          <option key={path} value={path}>
            {label}
          </option>
        ))}
      </select>
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Νέα τιμή, π.χ. «αύριο», «17:30», «80 ευρώ»" />
      <button type="submit">Αλλαγή</button>
    </form>
  );
}

function editableFields(card: ActionCard): Array<[string, string]> {
  switch (card.type) {
    case "create_appointment":
      return [["client_name", "Πελάτης"], ["date_text", "Ημερομηνία"], ["time_text", "Ώρα"], ["duration_text", "Διάρκεια"], ["title", "Σημείωση"]];
    case "reschedule_appointment":
      return [["client_name", "Πελάτης"], ["original_date_text", "Αρχική ημερομηνία"], ["new_date_text", "Νέα ημερομηνία"], ["new_time_text", "Νέα ώρα"]];
    case "cancel_appointment":
      return [["client_name", "Πελάτης"], ["date_text", "Ημερομηνία"], ["time_text", "Ώρα"]];
    case "query_calendar":
      return [["date_text", "Μέρα ή εβδομάδα"]];
    case "create_client":
      return [["client_name", "Όνομα"], ["vat_number_text", "ΑΦΜ"], ["phone_text", "Τηλέφωνο"], ["email_text", "Email"]];
    case "create_invoice": {
      const lines = card.fields.type === "create_invoice" ? card.fields.lines : [];
      const out: Array<[string, string]> = [["client_name", "Πελάτης"], ["price_basis_text", "Με/χωρίς ΦΠΑ"]];
      lines.forEach((_, i) => {
        const n = lines.length > 1 ? ` ${i + 1}` : "";
        out.push([`lines.${i}.description`, `Περιγραφή${n}`], [`lines.${i}.quantity_text`, `Ποσότητα${n}`], [`lines.${i}.amount_text`, `Ποσό${n}`]);
      });
      return out;
    }
  }
}

function fieldRows(f: ResolvedFields): Array<[string, string | null]> {
  const date = (d: string | null) => (d ? formatDate(d) : null);
  const startText = (iso: string | null) => (iso ? DateTime.fromISO(iso, { setZone: true }).toFormat("HH:mm") : null);
  switch (f.type) {
    case "create_appointment":
      return [
        ["Πελάτης", f.client_name],
        ["Ημερομηνία", date(f.date)],
        ["Ώρα", startText(f.start) ?? f.time],
        ["Διάρκεια", f.duration_minutes ? `${f.duration_minutes}'` : null],
        ...(f.title ? [["Σημείωση", f.title] as [string, string]] : []),
      ];
    case "reschedule_appointment":
      return [
        ["Πελάτης", f.client_name],
        ["Από", [date(f.original_date), f.original_time].filter(Boolean).join(" ") || null],
        ["Νέα ημερομηνία", date(f.new_date)],
        ["Νέα ώρα", f.new_time],
      ];
    case "cancel_appointment":
      return [
        ["Πελάτης", f.client_name],
        ["Ημερομηνία", date(f.date)],
        ["Ώρα", f.time],
      ];
    case "query_calendar":
      return [["Περίοδος", f.start && f.end ? (f.start === f.end ? date(f.start) : `${date(f.start)} – ${date(f.end)}`) : null]];
    case "create_client":
      return [
        ["Όνομα", f.client_name],
        ["ΑΦΜ", f.vat_number],
        ["Τηλέφωνο", f.phone],
        ["Email", f.email],
      ];
    case "create_invoice":
      return [
        ["Πελάτης", f.client_name],
        ...f.lines.flatMap((l, i): Array<[string, string | null]> => {
          const n = f.lines.length > 1 ? ` ${i + 1}` : "";
          const amount = l.amount
            ? `${formatEuro(l.amount)}${l.quantity !== "1" ? (l.amount_scope === "total" ? " συνολικά" : l.amount_scope === "unit" ? " ανά μονάδα" : "") : ""}`
            : null;
          return [
            [`Περιγραφή${n}`, l.description],
            [`Ποσότητα${n}`, l.quantity?.replace(".", ",") ?? null],
            [`Ποσό${n}`, amount],
          ];
        }),
        ["ΦΠΑ", f.price_basis === "with_vat" ? "Το ποσό περιλαμβάνει ΦΠΑ" : f.price_basis === "without_vat" ? "Το ποσό είναι χωρίς ΦΠΑ" : null],
      ];
  }
}
