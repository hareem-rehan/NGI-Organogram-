import { publicEnv } from "@/lib/env.public";
import { getAppVersion } from "@/lib/version";

export interface HealthPayload {
  status: "ok";
  application: string;
  environment: string;
  timestamp: string;
  version: string | null;
}

/**
 * Shallow application-health check for Phase 1: proves the process is up
 * and configuration loaded correctly. It does NOT check database
 * connectivity — there is no database client yet (Phase 2). Add a
 * readiness check alongside the Prisma client when that lands, without
 * changing this function's contract for callers that only need liveness.
 */
export function buildHealthPayload(): HealthPayload {
  return {
    status: "ok",
    application: publicEnv.NEXT_PUBLIC_APP_NAME,
    environment: process.env.NODE_ENV ?? "unknown",
    timestamp: new Date().toISOString(),
    version: getAppVersion(),
  };
}
