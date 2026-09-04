import "server-only";
import { parseServerEnv, type ServerEnv } from "./env";

/**
 * Server-only environment values. Importing this file from client
 * component code fails the build (the "server-only" package throws when
 * resolved outside a server context) rather than silently leaking
 * DATABASE_URL or other server secrets into the browser bundle.
 *
 * Never re-export individual fields of `serverEnv` through a module that
 * a client component imports — import `serverEnv` only from server-side
 * code (route handlers, server actions, server components that don't
 * pass the values as props to a client component).
 */
export const serverEnv: ServerEnv = parseServerEnv(process.env);
