import { Badge } from "@/components/ui/badge";

/**
 * Shown whenever the running environment isn't production, so nobody
 * mistakes a dev/test/staging instance for the real thing. Renders
 * nothing in production (no badge is itself the "production" signal —
 * still not color-only, since there's no color involved either way).
 */
export function EnvironmentBadge() {
  const environment = process.env.NODE_ENV;

  if (environment === "production") {
    return null;
  }

  const label = environment === "test" ? "Test" : "Development";

  return (
    <Badge variant="outline" className="tracking-wide uppercase">
      {label}
    </Badge>
  );
}
