/**
 * The connection string the running app uses (not migrations — those keep
 * DIRECT_DATABASE_URL). On Supabase, a serverless app must go through the
 * TRANSACTION pooler (port 6543): the session pooler (5432) holds one of
 * only 15 slots per open connection, and Vercel's many short-lived
 * functions exhaust them ("EMAXCONNSESSION max clients reached in session
 * mode" — staging outages on 2026-09-30 and 2026-10-01). So a Supabase
 * pooler URL on the session port is switched to the transaction port, with
 * the settings Prisma needs there. Anything else is returned unchanged.
 * The password inside the URL is never read or logged.
 */
export function runtimeDatabaseUrl(raw: string | undefined): {
  url: string | undefined;
  rewritten: boolean;
} {
  if (!raw) return { url: raw, rewritten: false };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { url: raw, rewritten: false };
  }
  if (!parsed.hostname.endsWith(".pooler.supabase.com")) return { url: raw, rewritten: false };

  let changed = false;
  if (parsed.port === "" || parsed.port === "5432") {
    parsed.port = "6543";
    changed = true;
  }
  if (parsed.searchParams.get("pgbouncer") !== "true") {
    parsed.searchParams.set("pgbouncer", "true");
    changed = true;
  }
  if (!parsed.searchParams.has("connection_limit")) {
    parsed.searchParams.set("connection_limit", "1");
    changed = true;
  }
  return changed ? { url: parsed.toString(), rewritten: true } : { url: raw, rewritten: false };
}
