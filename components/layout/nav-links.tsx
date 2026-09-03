"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_ITEMS, type NavItem } from "@/config/navigation";
import { cn } from "@/lib/utils";

interface NavLinksProps {
  onNavigate?: () => void;
  className?: string;
  /** Defaults to the full list — pass the permission-filtered subset from a Server Component (see components/layout/app-shell.tsx). */
  items?: readonly NavItem[];
}

export function NavLinks({ onNavigate, className, items = NAV_ITEMS }: NavLinksProps) {
  const pathname = usePathname();

  return (
    <ul className={cn("flex flex-col gap-1", className)}>
      {items.map((item) => {
        const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "focus-visible:ring-ring focus-visible:ring-offset-background block rounded-md px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
