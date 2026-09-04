import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

/**
 * Reusable inline error pattern for a section of a page (distinct from
 * the route-level app/error.tsx boundary, which catches render crashes).
 * `description` must already be a user-safe message — pass it through
 * lib/errors.ts's `toSafeErrorMessage()` first, never a raw error.message.
 */
export function ErrorState({
  title = "Something went wrong",
  description = "Please try again. If the problem continues, contact support.",
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="border-destructive/30 bg-destructive/5 flex flex-col items-center justify-center gap-3 rounded-lg border px-6 py-16 text-center"
    >
      <AlertTriangle aria-hidden="true" className="text-destructive size-10" />
      <p className="text-foreground text-base font-medium">{title}</p>
      <p className="text-muted-foreground max-w-md text-sm">{description}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
          Try again
        </Button>
      ) : null}
    </div>
  );
}
