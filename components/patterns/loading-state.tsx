import { Loader2 } from "lucide-react";

interface LoadingStateProps {
  label?: string;
}

/** Reusable loading indicator. Announced to assistive tech via role="status" so a screen-reader user knows something is in progress, not just visually spinning. */
export function LoadingState({ label = "Loading…" }: LoadingStateProps) {
  return (
    <div
      role="status"
      className="text-muted-foreground flex items-center justify-center gap-2 py-16"
    >
      <Loader2 aria-hidden="true" className="size-5 animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
