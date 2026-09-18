/**
 * Minimal structured logging abstraction (docs/ARCHITECTURE.md §13).
 *
 * Rules for callers:
 * - Never log secrets, tokens, passwords, or raw confidential HR fields
 *   (see CLAUDE.md §1.11 and docs/PROJECT_SPEC.md §13). Prefer entity IDs
 *   over raw field values.
 * - This is the ONLY place `console.*` is allowed in application code —
 *   eslint.config.mjs enforces `no-console` everywhere else so logging
 *   doesn't end up scattered through the codebase.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  [key: string]: unknown;
}

function write(level: LogLevel, message: string, fields?: LogFields): void {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...fields,
  };
  const line = JSON.stringify(entry);

  switch (level) {
    case "error":
      console.error(line);
      break;
    case "warn":
      console.warn(line);
      break;
    default:
      console.log(line);
  }
}

export const logger = {
  debug: (message: string, fields?: LogFields) => write("debug", message, fields),
  info: (message: string, fields?: LogFields) => write("info", message, fields),
  warn: (message: string, fields?: LogFields) => write("warn", message, fields),
  error: (message: string, fields?: LogFields) => write("error", message, fields),
};
