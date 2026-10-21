import { Fragment, useState } from "react";
import { DateTime } from "luxon";
import type { ActionCard, ResolvedFields } from "@core/intent-parsing/resolve";
import { formatDate, formatEuro } from "@core/intent-parsing/resolve";
import type { CardPreview, Choices } from "./api";
import { dayTitle, dateOf, time } from "./format";
import { InvoiceBreakdown } from "./InvoiceBreakdown";

export type CardStatus = "pending" | "busy" | "done" | "discarded";

export interface CardState {
  preview: CardPreview;
  choices: Choices;
  status: CardStatus;
  message: string | null;
  error: string | null;
}

interface Props {
  state: CardState;
  onAnswer: (field: string, value: string) => void;
  onChoose: (choices: Choices) => void;
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

const CONFIRM_LABEL: Record<ActionCard["type"], string> = {
  create_appointment: "Κλείσιμο ραντεβού",
  reschedule_appointment: "Μετακίνηση",
  cancel_appointment: "Ακύρωση ραντεβού",
  query_calendar: "Εντάξει",
  create_invoice: "Αποθήκευση προσχεδίου",
  create_client: "Προσθήκη πελάτη",
};

export function ActionCardView({ state, onAnswer, onChoose, onConfirm, onDiscard }: Props) {
  const { preview, status, choices } = state;
  const { card, context } = preview;
  const [editing, setEditing] = useState(false);
  const open = status === "pending" || status === "busy";
  const canConfirm = card.ready && context.blockers.length === 0 && status === "pending";

  return (
    <article className={`card card-${status}`} aria-label={TITLES[card.type]}>
      <header className="card-head">
        <h3>{TITLES[card.type]}</h3>
        {status === "done" && <span className="badge ok">Ολοκληρώθηκε</span>}
        {status === "discarded" && <span className="badge muted">Απορρίφθηκε</span>}
      </header>

      {card.type === "create_invoice" && open && (
        <p className="notice">
          Προσχέδιο. Η έκδοση γίνεται μόνο από την καρτέλα «Παραστατικά» με το κουμπί «Έκδοση», μετά από όλους τους
          υποχρεωτικούς ελέγχους.
        </p>
      )}

      <dl className="fields">
        {fieldRows(card.fields).map(([label, value]) => (
          <div key={label} className="row">
            <dt>{label}</dt>
            <dd className={value ? "" : "missing"}>{value ?? "—"}</dd>
          </div>
        ))}
      </dl>

      {context.agenda && <Agenda items={context.agenda} />}

      {open && context.clientChoice && (
        <ChoiceList
          title="Πελάτης"
          name={`client-${card.id}`}
          options={[
            ...context.clientChoice.options,
            { id: "new", label: `Νέος πελάτης «${context.clientChoice.newName ?? ""}»` },
          ]}
          selected={context.clientChoice.selected}
          onSelect={(id) => onChoose({ ...choices, clientId: id })}
        />
      )}

      {open && context.invoice && context.invoice.documentTypeChoice.options.length > 1 && (
        <ChoiceList
          title="Τύπος παραστατικού"
          name={`doc-${card.id}`}
          options={context.invoice.documentTypeChoice.options}
          selected={context.invoice.documentTypeChoice.selected}
          onSelect={(id) => onChoose({ ...choices, documentTypeId: id })}
        />
      )}
      {open &&
        context.invoice?.lines.map((l, i) =>
          l.options.length > 1 ? (
            <label key={i} className="inline-select">
              ΦΠΑ γραμμής {i + 1}
              <select
                value={l.vat_category_id}
                onChange={(e) => {
                  const ids = context.invoice!.lines.map((x) => x.vat_category_id);
                  ids[i] = e.target.value;
                  onChoose({ ...choices, lineVatCategoryIds: ids });
                }}
              >
                {l.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null,
        )}
      {context.invoice?.calc && <InvoiceBreakdown calc={context.invoice.calc} />}

      {open && context.appointmentChoice && context.appointmentChoice.options.length > 0 && (
        <ChoiceList
          title="Ποιο ραντεβού"
          name={`appt-${card.id}`}
          options={context.appointmentChoice.options}
          selected={context.appointmentChoice.selected}
          onSelect={(id) => onChoose({ ...choices, appointmentId: id })}
        />
      )}

      {open && card.assumptions.length > 0 && (
        <ul className="assumptions">
          {card.assumptions.map((a) => (
            <li key={a.field + a.message}>⚠️ {a.message}</li>
          ))}
        </ul>
      )}
      {open && context.warnings.length > 0 && (
        <ul className="assumptions">
          {context.warnings.map((w) => (
            <li key={w}>⚠️ {w}</li>
          ))}
        </ul>
      )}
      {open && context.blockers.length > 0 && (
        <ul className="blockers">
          {context.blockers.map((b) => (
            <li key={b}>⛔ {b}</li>
          ))}
        </ul>
      )}

      {open && card.questions.map((q) => <QuestionView key={q.field} question={q} onAnswer={(v) => onAnswer(q.field, v)} />)}
      {open && editing && <EditForm card={card} onSubmit={(f, v) => (onAnswer(f, v), setEditing(false))} />}

      {state.error && open && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.message && status === "done" && <p className="note">{state.message}</p>}

      {open && (
        <div className="actions">
          <button className="primary" disabled={!canConfirm} onClick={onConfirm}>
            {status === "busy" ? "Περιμένε…" : CONFIRM_LABEL[card.type]}
          </button>
          {card.type !== "query_calendar" && (
            <button onClick={() => setEditing((e) => !e)} disabled={status === "busy"}>
              {editing ? "Κλείσιμο" : "Διόρθωση"}
            </button>
          )}
          <button className="danger" onClick={onDiscard} disabled={status === "busy"}>
            Απόρριψη
          </button>
        </div>
      )}
    </article>
  );
}

function Agenda({ items }: { items: NonNullable<CardPreview["context"]["agenda"]> }) {
  if (items.length === 0) return <p className="note">Κανένα ραντεβού σε αυτό το διάστημα.</p>;
  let lastDay = "";
  return (
    <ul className="agenda">
      {items.map((a) => {
        const day = dateOf(a.starts_at);
        const header = day !== lastDay ? <li className="agenda-day">{dayTitle(day)}</li> : null;
        lastDay = day;
        return (
          <Fragment key={a.id}>
            {header}
            <li>
              <strong>{time(a.starts_at)}</strong>–{time(a.ends_at)} {a.client_name}
              {a.title ? ` · ${a.title}` : ""}
            </li>
          </Fragment>
        );
      })}
    </ul>
  );
}

function ChoiceList(props: {
  title: string;
  name: string;
  options: Array<{ id: string; label: string }>;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <fieldset className="choices">
      <legend>{props.title}</legend>
      {props.options.map((o) => (
        <label key={o.id}>
          <input type="radio" name={props.name} checked={props.selected === o.id} onChange={() => props.onSelect(o.id)} />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

function QuestionView({ question, onAnswer }: { question: ActionCard["questions"][number]; onAnswer: (value: string) => void }) {
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
        ["Νέα ημερομηνία", date(f.new_date)],
        ["Νέα ώρα", f.new_time],
      ];
    case "cancel_appointment":
      return [
        ["Πελάτης", f.client_name],
        ["Ημερομηνία", date(f.date)],
        ...(f.time ? [["Ώρα", f.time] as [string, string]] : []),
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
