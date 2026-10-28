import type { Db } from "../db/db";

/**
 * Everything stored about a user, for the GDPR right of access/portability.
 * Secrets (password hash, session tokens, encrypted Google token and myDATA keys) are omitted.
 */
export async function exportUserData(db: Db, userId: string) {
  const [user] = await db.query("select id, email, created_at from users where id = $1", [userId]);
  const clients = await db.query(
    "select id, name, vat_number, phone, email, created_at from clients where user_id = $1 order by created_at",
    [userId],
  );
  const appointments = await db.query(
    `select id, client_id, client_name, title, starts_at, ends_at, status, google_sync_status, created_at, updated_at
     from appointments where user_id = $1 order by starts_at`,
    [userId],
  );
  const actions = await db.query(
    "select card_id, result, created_at from executed_actions where user_id = $1 order by created_at",
    [userId],
  );
  const profile = await db.query("select data, updated_at from business_profiles where user_id = $1", [userId]);
  const invoices = await db.query(
    `select id, status, environment, document_type_id, series, number, issue_date, draft, mark, uid, request_xml,
            response_body, aade_error, cancellation, created_at, issued_at
     from invoices where user_id = $1 order by created_at`,
    [userId],
  );
  const aade = await db.query("select environment, updated_at from aade_credentials where user_id = $1", [userId]);
  const google = await db.query("select calendar_id, created_at from google_connections where user_id = $1", [userId]);
  return {
    exported_at: new Date().toISOString(),
    user,
    clients,
    appointments,
    confirmed_actions: actions,
    business_profile: profile[0] ?? null,
    invoices,
    // Credentials themselves are not exported; only which environments are configured.
    aade_credentials_configured: aade,
    google_calendar: google[0] ?? null,
  };
}
