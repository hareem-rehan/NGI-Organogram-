"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { logger } from "@/lib/logger";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Route-level error boundary (Next.js convention). The user only ever
 * sees a generic message here — the real error (message/stack/digest)
 * goes to server-side logs only. See docs/ARCHITECTURE.md §12.
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    logger.error("unhandled render error", {
      digest: error.digest ?? null,
    });
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-destructive text-sm font-medium">Error</p>
      <h1 className="text-foreground text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground max-w-md text-sm">
        We hit an unexpected problem loading this page. You can try again, or head back to the
        dashboard.
      </p>
      <div className="mt-2 flex gap-2">
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
        <Button asChild>
          <a href="/dashboard">Go to Dashboard</a>
        </Button>
      </div>
    </div>
  );
}
