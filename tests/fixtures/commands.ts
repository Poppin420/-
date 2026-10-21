import type { ActionType } from "../../src/intent-parsing/schema";
import type { ParseResult } from "../../src/intent-parsing";

/**
 * Greek command corpus. `llm` is the extraction a correct model should
 * return (verbatim spans); unit tests feed it through a fake LLM, and
 * scripts/eval-llm.ts sends `transcript` to the real model and checks the
 * same expectations. Reference time: Wednesday 2026-10-21 10:00 Athens.
 */
export const REFERENCE_NOW = new Date("2026-10-21T07:00:00Z");

export interface ExpectedCard {
  type: ActionType;
  /** Subset of resolved fields that must match exactly. */
  fields?: Record<string, unknown>;
  /** Exact set of fields the card must ask about (order-insensitive). */
  asks?: string[];
}

export interface CommandCase {
  name: string;
  transcript: string;
  llm: unknown;
  expect: ExpectedCard[];
}

export const COMMAND_CASES: CommandCase[] = [
  {
    name: "spec example: appointment + invoice in one sentence",
    transcript: "Κλείσε ραντεβού με τη Μαρία αύριο στις 5 και κόψε τιμολόγιο 80 ευρώ στον κ. Νίκο",
    llm: {
      actions: [
        { type: "create_appointment", client_name: "Μαρία", date_text: "αύριο", time_text: "στις 5" },
        { type: "create_invoice", client_name: "Νίκο", lines: [{ amount_text: "80 ευρώ" }] },
      ],
    },
    expect: [
      { type: "create_appointment", fields: { client_name: "Μαρία", date: "2026-10-22", time: null }, asks: ["time_text"] },
      {
        type: "create_invoice",
        fields: { client_name: "Νίκο", lines: [{ description: null, quantity: "1", amount: "80.00", amount_scope: "unit" }] },
        asks: ["lines.0.description", "price_basis_text"],
      },
    ],
  },
  {
    name: "full appointment with weekday and pm time",
    transcript: "Ραντεβού με τον Γιώργο Παπαδόπουλο την Παρασκευή στις πέντε το απόγευμα",
    llm: {
      actions: [
        { type: "create_appointment", client_name: "Γιώργο Παπαδόπουλο", date_text: "την Παρασκευή", time_text: "στις πέντε το απόγευμα" },
      ],
    },
    expect: [
      {
        type: "create_appointment",
        fields: { date: "2026-10-23", time: "17:00", start: "2026-10-23T17:00:00+03:00", duration_minutes: 60 },
        asks: [],
      },
    ],
  },
  {
    name: "after the DST change the offset is +02:00",
    transcript: "Κλείσε στην Ελένη τη Δευτέρα στις 10 το πρωί για μισή ώρα",
    llm: {
      actions: [
        { type: "create_appointment", client_name: "Ελένη", date_text: "τη Δευτέρα", time_text: "στις 10 το πρωί", duration_text: "μισή ώρα" },
      ],
    },
    expect: [
      { type: "create_appointment", fields: { start: "2026-10-26T10:00:00+02:00", duration_minutes: 30 }, asks: [] },
    ],
  },
  {
    name: "explicit date and 24h time",
    transcript: "Βάλε ραντεβού στις 25 Οκτωβρίου στις 18:00 με την κυρία Κατερίνα",
    llm: {
      actions: [
        { type: "create_appointment", client_name: "Κατερίνα", date_text: "25 Οκτωβρίου", time_text: "18:00" },
      ],
    },
    expect: [{ type: "create_appointment", fields: { start: "2026-10-25T18:00:00+02:00" }, asks: [] }],
  },
  {
    name: "missing client is asked",
    transcript: "Κλείσε ραντεβού αύριο στις έξι το απόγευμα",
    llm: { actions: [{ type: "create_appointment", client_name: null, date_text: "αύριο", time_text: "στις έξι το απόγευμα" }] },
    expect: [{ type: "create_appointment", fields: { time: "18:00" }, asks: ["client_name"] }],
  },
  {
    name: "weekday equal to today is ambiguous",
    transcript: "Ραντεβού με τον Κώστα την Τετάρτη στις 9 το πρωί",
    llm: { actions: [{ type: "create_appointment", client_name: "Κώστα", date_text: "την Τετάρτη", time_text: "στις 9 το πρωί" }] },
    expect: [{ type: "create_appointment", fields: { date: null, time: "09:00" }, asks: ["date_text"] }],
  },
  {
    name: "complete invoice with VAT included",
    transcript: "Κόψε τιμολόγιο εκατόν είκοσι ευρώ με ΦΠΑ στην Αλφα ΑΕ για συμβουλευτικές υπηρεσίες",
    llm: {
      actions: [
        {
          type: "create_invoice",
          client_name: "Αλφα ΑΕ",
          price_basis_text: "με ΦΠΑ",
          lines: [{ description: "συμβουλευτικές υπηρεσίες", amount_text: "εκατόν είκοσι ευρώ" }],
        },
      ],
    },
    expect: [
      {
        type: "create_invoice",
        fields: {
          client_name: "Αλφα ΑΕ",
          price_basis: "with_vat",
          lines: [{ description: "συμβουλευτικές υπηρεσίες", quantity: "1", amount: "120.00", amount_scope: "unit" }],
        },
        asks: [],
      },
    ],
  },
  {
    name: "invoice with net amount",
    transcript: "Τιμολόγιο στον Νίκο 80€ πλέον ΦΠΑ για επισκευή υδραυλικών",
    llm: {
      actions: [
        {
          type: "create_invoice",
          client_name: "Νίκο",
          price_basis_text: "πλέον ΦΠΑ",
          lines: [{ description: "επισκευή υδραυλικών", amount_text: "80€" }],
        },
      ],
    },
    expect: [{ type: "create_invoice", fields: { price_basis: "without_vat" }, asks: [] }],
  },
  {
    name: "quantity > 1 asks whether the amount is per unit",
    transcript: "Βγάλε απόδειξη στη Σοφία για δύο συνεδρίες 50 ευρώ με ΦΠΑ",
    llm: {
      actions: [
        {
          type: "create_invoice",
          client_name: "Σοφία",
          price_basis_text: "με ΦΠΑ",
          lines: [{ description: "συνεδρίες", quantity_text: "δύο", amount_text: "50 ευρώ" }],
        },
      ],
    },
    expect: [
      {
        type: "create_invoice",
        fields: { lines: [{ description: "συνεδρίες", quantity: "2", amount: "50.00", amount_scope: null }] },
        asks: ["lines.0.amount_scope"],
      },
    ],
  },
  {
    name: "bare invoice asks for everything missing",
    transcript: "Κόψε τιμολόγιο στον Πέτρο",
    llm: { actions: [{ type: "create_invoice", client_name: "Πέτρο", lines: [] }] },
    expect: [
      { type: "create_invoice", asks: ["lines.0.description", "lines.0.amount_text", "price_basis_text"] },
    ],
  },
  {
    name: "approximate amount is not accepted",
    transcript: "Κόψε τιμολόγιο περίπου 100 ευρώ στον Άρη για καθαρισμό με ΦΠΑ",
    llm: {
      actions: [
        {
          type: "create_invoice",
          client_name: "Άρη",
          price_basis_text: "με ΦΠΑ",
          lines: [{ description: "καθαρισμό", amount_text: "περίπου 100 ευρώ" }],
        },
      ],
    },
    expect: [{ type: "create_invoice", asks: ["lines.0.amount_text"] }],
  },
  {
    name: "query tomorrow",
    transcript: "Τι ραντεβού έχω αύριο;",
    llm: { actions: [{ type: "query_calendar", date_text: "αύριο" }] },
    expect: [{ type: "query_calendar", fields: { start: "2026-10-22", end: "2026-10-22" }, asks: [] }],
  },
  {
    name: "query next week (genitive)",
    transcript: "Δείξε μου το πρόγραμμα της επόμενης εβδομάδας",
    llm: { actions: [{ type: "query_calendar", date_text: "της επόμενης εβδομάδας" }] },
    expect: [{ type: "query_calendar", fields: { start: "2026-10-26", end: "2026-11-01" }, asks: [] }],
  },
  {
    name: "query weekday",
    transcript: "Τι έχω την Παρασκευή;",
    llm: { actions: [{ type: "query_calendar", date_text: "την Παρασκευή" }] },
    expect: [{ type: "query_calendar", fields: { start: "2026-10-23" }, asks: [] }],
  },
  {
    name: "reschedule",
    transcript: "Μετέφερε το ραντεβού της Μαρίας για την Πέμπτη στις 4 το απόγευμα",
    llm: {
      actions: [
        { type: "reschedule_appointment", client_name: "Μαρίας", new_date_text: "την Πέμπτη", new_time_text: "στις 4 το απόγευμα" },
      ],
    },
    expect: [
      {
        type: "reschedule_appointment",
        fields: { client_name: "Μαρίας", new_date: "2026-10-22", new_time: "16:00", new_start: "2026-10-22T16:00:00+03:00" },
        asks: [],
      },
    ],
  },
  {
    name: "cancel with client and date",
    transcript: "Ακύρωσε το ραντεβού με τον Γιάννη αύριο",
    llm: { actions: [{ type: "cancel_appointment", client_name: "Γιάννη", date_text: "αύριο" }] },
    expect: [{ type: "cancel_appointment", fields: { client_name: "Γιάννη", date: "2026-10-22" }, asks: [] }],
  },
  {
    name: "cancel without anything to identify it",
    transcript: "Ακύρωσε το ραντεβού",
    llm: { actions: [{ type: "cancel_appointment" }] },
    expect: [{ type: "cancel_appointment", asks: ["client_name"] }],
  },
  {
    name: "new client with valid spoken AFM",
    transcript: "Πρόσθεσε νέο πελάτη Δημήτρης Αντωνίου με ΑΦΜ 094014201",
    llm: { actions: [{ type: "create_client", client_name: "Δημήτρης Αντωνίου", vat_number_text: "094014201" }] },
    expect: [{ type: "create_client", fields: { vat_number: "094014201" }, asks: [] }],
  },
  {
    name: "new client with invalid AFM",
    transcript: "Νέος πελάτης Ιωάννα Κ. με ΑΦΜ 094014202",
    llm: { actions: [{ type: "create_client", client_name: "Ιωάννα Κ.", vat_number_text: "094014202" }] },
    expect: [{ type: "create_client", fields: { vat_number: null }, asks: ["vat_number_text"] }],
  },
  {
    name: "hallucinated client name is rejected",
    transcript: "Κλείσε ραντεβού αύριο στις 5 το απόγευμα",
    llm: { actions: [{ type: "create_appointment", client_name: "Μαρία", date_text: "αύριο", time_text: "στις 5 το απόγευμα" }] },
    expect: [{ type: "create_appointment", fields: { client_name: null, time: "17:00" }, asks: ["client_name"] }],
  },
  {
    name: "LLM-normalized amount (not verbatim) is rejected",
    transcript: "Κόψε τιμολόγιο ογδόντα ευρώ με ΦΠΑ στη Μαρία για μάθημα",
    llm: {
      actions: [
        { type: "create_invoice", client_name: "Μαρία", price_basis_text: "με ΦΠΑ", lines: [{ description: "μάθημα", amount_text: "80" }] },
      ],
    },
    expect: [{ type: "create_invoice", asks: ["lines.0.amount_text"] }],
  },
  {
    name: "noon expression and day after tomorrow",
    transcript: "Ραντεβού με τη Μαρία στις 3 το μεσημέρι μεθαύριο",
    llm: { actions: [{ type: "create_appointment", client_name: "Μαρία", date_text: "μεθαύριο", time_text: "στις 3 το μεσημέρι" }] },
    expect: [{ type: "create_appointment", fields: { start: "2026-10-23T15:00:00+03:00" }, asks: [] }],
  },
  {
    name: "appointment + receipt with half-past and duration",
    transcript:
      "Ραντεβού με Νίκο αύριο στις 9 και μισή το πρωί για μία ώρα και κόψε του απόδειξη σαράντα ευρώ με ΦΠΑ για μάθημα",
    llm: {
      actions: [
        { type: "create_appointment", client_name: "Νίκο", date_text: "αύριο", time_text: "στις 9 και μισή το πρωί", duration_text: "μία ώρα" },
        { type: "create_invoice", client_name: "Νίκο", price_basis_text: "με ΦΠΑ", lines: [{ description: "μάθημα", amount_text: "σαράντα ευρώ" }] },
      ],
    },
    expect: [
      { type: "create_appointment", fields: { start: "2026-10-22T09:30:00+03:00", duration_minutes: 60 }, asks: [] },
      { type: "create_invoice", fields: { lines: [{ description: "μάθημα", quantity: "1", amount: "40.00", amount_scope: "unit" }] }, asks: [] },
    ],
  },
  {
    name: "11:30 without period is ambiguous",
    transcript: "Κλείσε ραντεβού με την Άννα 30/10 στις 11:30",
    llm: { actions: [{ type: "create_appointment", client_name: "Άννα", date_text: "30/10", time_text: "στις 11:30" }] },
    expect: [{ type: "create_appointment", fields: { date: "2026-10-30" }, asks: ["time_text"] }],
  },
  {
    name: "explicit November date",
    transcript: "Ραντεβού με τον Μιχάλη στις 5 Νοεμβρίου στις 19:00",
    llm: { actions: [{ type: "create_appointment", client_name: "Μιχάλη", date_text: "5 Νοεμβρίου", time_text: "στις 19:00" }] },
    expect: [{ type: "create_appointment", fields: { start: "2026-11-05T19:00:00+02:00" }, asks: [] }],
  },
  {
    name: "past date is asked",
    transcript: "Κλείσε ραντεβού με τον Στέλιο χθες στις 10 το πρωί",
    llm: { actions: [{ type: "create_appointment", client_name: "Στέλιο", date_text: "χθες", time_text: "στις 10 το πρωί" }] },
    expect: [{ type: "create_appointment", asks: ["date_text"] }],
  },
  {
    name: "weekday/date conflict is asked",
    transcript: "Ραντεβού με τη Ζωή την Πέμπτη 23 Οκτωβρίου στις 12 το μεσημέρι",
    llm: { actions: [{ type: "create_appointment", client_name: "Ζωή", date_text: "την Πέμπτη 23 Οκτωβρίου", time_text: "στις 12 το μεσημέρι" }] },
    expect: [{ type: "create_appointment", fields: { time: "12:00" }, asks: ["date_text"] }],
  },
  {
    name: "Greek-formatted amount with thousands separator",
    transcript: "Κόψε τιμολόγιο 1.200,50 € χωρίς ΦΠΑ στην Beta Software για ανάπτυξη λογισμικού",
    llm: {
      actions: [
        {
          type: "create_invoice",
          client_name: "Beta Software",
          price_basis_text: "χωρίς ΦΠΑ",
          lines: [{ description: "ανάπτυξη λογισμικού", amount_text: "1.200,50 €" }],
        },
      ],
    },
    expect: [{ type: "create_invoice", fields: { price_basis: "without_vat", lines: [{ description: "ανάπτυξη λογισμικού", quantity: "1", amount: "1200.50", amount_scope: "unit" }] }, asks: [] }],
  },
  {
    name: "hours of work asks for unit vs total",
    transcript: "Τιμολόγιο στον Λευτέρη για τρεις ώρες εργασίας 30 ευρώ την ώρα πλέον ΦΠΑ",
    llm: {
      actions: [
        {
          type: "create_invoice",
          client_name: "Λευτέρη",
          price_basis_text: "πλέον ΦΠΑ",
          lines: [{ description: "εργασίας", quantity_text: "τρεις ώρες", amount_text: "30 ευρώ" }],
        },
      ],
    },
    expect: [{ type: "create_invoice", fields: { lines: [{ description: "εργασίας", quantity: "3", amount: "30.00", amount_scope: null }] }, asks: ["lines.0.amount_scope"] }],
  },
  {
    name: "'την επόμενη Παρασκευή' is ambiguous",
    transcript: "Ραντεβού με την Ειρήνη την επόμενη Παρασκευή στις 8 το βράδυ",
    llm: { actions: [{ type: "create_appointment", client_name: "Ειρήνη", date_text: "την επόμενη Παρασκευή", time_text: "στις 8 το βράδυ" }] },
    expect: [{ type: "create_appointment", fields: { time: "20:00" }, asks: ["date_text"] }],
  },
  {
    name: "relative days and minutes duration",
    transcript: "Ραντεβού με τον Άγγελο σε τρεις μέρες στις 14:00 για 45 λεπτά",
    llm: {
      actions: [
        { type: "create_appointment", client_name: "Άγγελο", date_text: "σε τρεις μέρες", time_text: "στις 14:00", duration_text: "45 λεπτά" },
      ],
    },
    expect: [{ type: "create_appointment", fields: { start: "2026-10-24T14:00:00+03:00", duration_minutes: 45 }, asks: [] }],
  },
  {
    name: "three actions in one command",
    transcript:
      "Κλείσε ραντεβού με τη Μαρία την Παρασκευή στις 5 το απόγευμα, με τον Γιώργο το Σάββατο στις 10 το πρωί και πες μου τι έχω τη Δευτέρα",
    llm: {
      actions: [
        { type: "create_appointment", client_name: "Μαρία", date_text: "την Παρασκευή", time_text: "στις 5 το απόγευμα" },
        { type: "create_appointment", client_name: "Γιώργο", date_text: "το Σάββατο", time_text: "στις 10 το πρωί" },
        { type: "query_calendar", date_text: "τη Δευτέρα" },
      ],
    },
    expect: [
      { type: "create_appointment", fields: { start: "2026-10-23T17:00:00+03:00" }, asks: [] },
      { type: "create_appointment", fields: { start: "2026-10-24T10:00:00+03:00" }, asks: [] },
      { type: "query_calendar", fields: { start: "2026-10-26" }, asks: [] },
    ],
  },
  {
    name: "small talk produces no actions",
    transcript: "Καλημέρα, τι καιρό κάνει σήμερα;",
    llm: { actions: [], unrecognized: ["τι καιρό κάνει σήμερα"] },
    expect: [],
  },
  {
    name: "amount with cents in words",
    transcript: "Απόδειξη στην Κική ογδόντα ευρώ και πενήντα λεπτά με ΦΠΑ για κούρεμα",
    llm: {
      actions: [
        {
          type: "create_invoice",
          client_name: "Κική",
          price_basis_text: "με ΦΠΑ",
          lines: [{ description: "κούρεμα", amount_text: "ογδόντα ευρώ και πενήντα λεπτά" }],
        },
      ],
    },
    expect: [{ type: "create_invoice", fields: { lines: [{ description: "κούρεμα", quantity: "1", amount: "80.50", amount_scope: "unit" }] }, asks: [] }],
  },
  {
    name: "query this week",
    transcript: "Τι έχω αυτή την εβδομάδα;",
    llm: { actions: [{ type: "query_calendar", date_text: "αυτή την εβδομάδα" }] },
    expect: [{ type: "query_calendar", fields: { start: "2026-10-19", end: "2026-10-25" }, asks: [] }],
  },
];

/** Returns human-readable mismatches between a parse result and expectations. */
export function checkCase(result: ParseResult, expected: ExpectedCard[]): string[] {
  const problems: string[] = [];
  if (result.cards.length !== expected.length) {
    problems.push(`expected ${expected.length} cards, got ${result.cards.length}`);
    return problems;
  }
  expected.forEach((exp, i) => {
    const card = result.cards[i]!;
    if (card.type !== exp.type) problems.push(`card ${i}: type ${card.type} != ${exp.type}`);
    for (const [key, value] of Object.entries(exp.fields ?? {})) {
      const actual = (card.fields as unknown as Record<string, unknown>)[key];
      if (JSON.stringify(actual) !== JSON.stringify(value)) {
        problems.push(`card ${i}: ${key} = ${JSON.stringify(actual)}, expected ${JSON.stringify(value)}`);
      }
    }
    if (exp.asks) {
      const asked = card.questions.map((q) => q.field).sort();
      const want = [...exp.asks].sort();
      if (JSON.stringify(asked) !== JSON.stringify(want)) {
        problems.push(`card ${i}: asks ${JSON.stringify(asked)}, expected ${JSON.stringify(want)}`);
      }
      if (card.ready !== (want.length === 0)) problems.push(`card ${i}: ready = ${card.ready}`);
    }
  });
  return problems;
}
