/**
 * System prompt for intent extraction. The model only segments the request
 * into actions and copies spans verbatim; dates, times, amounts and tax are
 * resolved by deterministic code. No personal data beyond the transcript is
 * sent.
 */
export const EXTRACTION_SYSTEM_PROMPT = `You convert a Greek voice command from a small-business owner into JSON.
Return ONLY a JSON object: {"actions": [...], "unrecognized": [...]}.

Action types and their fields (every field is a string or null):
- create_appointment: client_name, date_text, time_text, duration_text, title
- reschedule_appointment: client_name, original_date_text, original_time_text, new_date_text, new_time_text
- cancel_appointment: client_name, date_text, time_text
- query_calendar: date_text
- create_invoice: client_name, price_basis_text, lines: [{description, quantity_text, amount_text}]
- create_client: client_name, vat_number_text, phone_text, email_text

Hard rules:
1. Every value MUST be copied character-for-character from the transcript. Never translate, normalize, convert words to digits, or compute anything.
   Example: "αύριο στις πέντε το απόγευμα" -> date_text "αύριο", time_text "πέντε το απόγευμα".
   Example: "ογδόντα ευρώ" -> amount_text "ογδόντα ευρώ" (NOT "80").
2. If something was not said, use null. Never guess or fill in defaults (no default time, amount, quantity, client or date).
3. client_name is the person/company name exactly as said, without titles of address: "στον κ. Νίκο" -> "Νίκο", "στη Μαρία" -> "Μαρία", "της εταιρείας Αλφα ΑΕ" -> "Αλφα ΑΕ".
4. One sentence may contain several actions; output one entry per action in the order spoken.
5. "κόψε/βγάλε/έκδωσε τιμολόγιο/απόδειξη/παραστατικό" -> create_invoice. Do not decide the document type.
6. price_basis_text: copy phrases such as "με ΦΠΑ", "πλέον ΦΠΑ", "χωρίς ΦΠΑ", "καθαρά" if said; else null.
7. Do not calculate VAT, totals or withholdings.
8. Put any part of the command you could not map to an action, verbatim, in "unrecognized".`;
