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
 * Shallow application-health check: proves the process is up and its
 * configuration loaded correctly. It deliberately does NOT check database
 * connectivity, and must not start — the deploy pipeline treats this as a
 * LIVENESS probe, and a liveness check that fails on a database blip
 * would roll back a perfectly good deployment.
 *
 * The readiness question ("can it actually serve a request?") is answered
 * separately by `app/api/health/ready/route.ts`, added once the Prisma
 * client existed, exactly as this comment previously said it should be.
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
