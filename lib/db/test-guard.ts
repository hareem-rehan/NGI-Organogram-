/**
 * Refuses to let a destructive test operation (truncate, reset) run
 * against anything that doesn't clearly look like a disposable test
 * database. Pure function — no I/O — so it's testable without a live
 * connection (see lib/db/test-guard.test.ts).
 *
 * This is deliberately conservative: it requires the database NAME
 * (the path segment of the connection URL) to contain "test", and
 * rejects anything that looks production-like even if it also happens
 * to contain "test" somewhere. When in doubt, refuse.
 */
export class UnsafeTestDatabaseError extends Error {
  constructor(reason: string) {
    super(`Refusing a destructive test-database operation: ${reason}`);
    this.name = "UnsafeTestDatabaseError";
  }
}

const PRODUCTION_LOOKING_PATTERNS = [/prod/i, /production/i];

export function assertSafeTestDatabaseUrl(databaseUrl: string | undefined): void {
  if (!databaseUrl) {
    throw new UnsafeTestDatabaseError("DATABASE_URL is not set.");
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new UnsafeTestDatabaseError("DATABASE_URL could not be parsed as a URL.");
  }

  const databaseName = parsed.pathname.replace(/^\//, "");

  for (const pattern of PRODUCTION_LOOKING_PATTERNS) {
    if (pattern.test(databaseName) || pattern.test(parsed.hostname)) {
      throw new UnsafeTestDatabaseError(
        `database name/host "${databaseName}"@"${parsed.hostname}" looks production-related.`
      );
    }
  }

  if (!/test/i.test(databaseName)) {
    throw new UnsafeTestDatabaseError(
      `database name "${databaseName}" does not contain "test" — refusing to assume it's disposable.`
    );
  }
}
