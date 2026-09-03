import { LogOut, UserCircle } from "lucide-react";

import type { CurrentUser } from "@/lib/auth/current-user";
import { signOutAction } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";

interface AccountAreaProps {
  user: CurrentUser | null;
}

/**
 * Takes the already-resolved user as a prop (fetched once, in
 * app-shell.tsx) rather than calling getCurrentUser() again itself —
 * avoids a duplicate session lookup per request, and keeps this a plain
 * synchronous component (nested async Server Components don't render
 * under React Testing Library's synchronous `render()`, which would
 * otherwise make this untestable in isolation).
 */
export function AccountArea({ user }: AccountAreaProps) {
  if (!user) {
    return (
      <Button variant="ghost" size="icon" disabled aria-label="Not signed in">
        <UserCircle aria-hidden="true" />
      </Button>
    );
  }

  return (
    <form action={signOutAction} className="flex items-center gap-2">
      <span className="text-muted-foreground hidden max-w-[12rem] truncate text-sm sm:inline">
        {user.email ?? user.name ?? "Signed in"}
      </span>
      <Button variant="ghost" size="icon" type="submit" aria-label={`Sign out (${user.role})`}>
        <LogOut aria-hidden="true" />
      </Button>
    </form>
  );
}
