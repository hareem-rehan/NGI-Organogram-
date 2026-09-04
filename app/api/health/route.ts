import { NextResponse } from "next/server";
import { buildHealthPayload } from "@/lib/health";
import { logger } from "@/lib/logger";

export async function GET() {
  try {
    const payload = buildHealthPayload();
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    // Never forward the raw error (message, stack) to the client — only
    // to server logs. See docs/ARCHITECTURE.md §12/§13.
    logger.error("health check failed", {
      reason: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
