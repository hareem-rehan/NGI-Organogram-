import { parsePublicEnv, type PublicEnv } from "./env";

/**
 * Browser-safe environment values only. Every field here must be
 * prefixed NEXT_PUBLIC_ in .env — anything without that prefix belongs
 * in env.server.ts instead, never here.
 */
export const publicEnv: PublicEnv = parsePublicEnv(process.env);
