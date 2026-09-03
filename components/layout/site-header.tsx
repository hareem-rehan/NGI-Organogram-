import Link from "next/link";

import type { NavItem } from "@/config/navigation";
import type { CurrentUser } from "@/lib/auth/current-user";
import { publicEnv } from "@/lib/env.public";
import { MobileNav } from "@/components/layout/mobile-nav";
import { EnvironmentBadge } from "@/components/layout/environment-badge";
import { AccountArea } from "@/components/layout/account-area";

interface SiteHeaderProps {
  navItems: readonly NavItem[];
  user: CurrentUser | null;
}

export function SiteHeader({ navItems, user }: SiteHeaderProps) {
  return (
    <header className="border-border bg-background sticky top-0 z-40 flex h-14 items-center gap-3 border-b px-4">
      <MobileNav items={navItems} />
      <Link
        href="/dashboard"
        className="focus-visible:ring-ring min-w-0 truncate rounded-md text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        title={publicEnv.NEXT_PUBLIC_APP_NAME}
      >
        {publicEnv.NEXT_PUBLIC_APP_NAME}
      </Link>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <EnvironmentBadge />
        <AccountArea user={user} />
      </div>
    </header>
  );
}
