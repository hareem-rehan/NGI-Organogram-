import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { NAV_ITEMS } from "@/config/navigation";
import { getCurrentUser, hasPermission } from "@/lib/auth/current-user";
import { SkipToContent } from "@/components/layout/skip-to-content";
import { SiteHeader } from "@/components/layout/site-header";
import { DesktopNav } from "@/components/layout/desktop-nav";

interface AppShellProps {
  children: ReactNode;
}

/**
 * The authoritative authentication boundary for every route under
 * app/(app)/ (docs/AUTHORIZATION_MATRIX.md "Server-Side Authorization
 * Strategy") — this is a Server Component running in the Node.js
 * runtime, so it can safely call getCurrentUser() (a real database
 * session lookup), not just check for a cookie's presence the way Edge
 * middleware would have to. Deliberately no middleware.ts — see
 * docs/adr/0012-session-and-route-protection.md for why a Node-runtime
 * layout check is this project's chosen (and sufficient) boundary.
 *
 * Navigation is filtered by permission for UX — but every route this
 * links to must independently re-check permission server-side too
 * (CLAUDE.md §1.8); a hidden link is never the real protection.
 */
export async function AppShell({ children }: AppShellProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/sign-in");
  }
  if (user.status !== "ACTIVE") {
    redirect("/sign-in?error=AccessDenied");
  }

  const visibleNavItems = NAV_ITEMS.filter((item) => hasPermission(user, item.permission));

  return (
    <div className="flex min-h-screen flex-col">
      <SkipToContent />
      <SiteHeader navItems={visibleNavItems} user={user} />
      <div className="flex flex-1">
        <DesktopNav items={visibleNavItems} />
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
