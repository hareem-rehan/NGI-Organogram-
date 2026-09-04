import type { NavItem } from "@/config/navigation";
import { NavLinks } from "@/components/layout/nav-links";

interface DesktopNavProps {
  items: readonly NavItem[];
}

export function DesktopNav({ items }: DesktopNavProps) {
  return (
    <nav aria-label="Primary" className="border-border hidden w-60 shrink-0 border-r p-4 md:block">
      <NavLinks items={items} />
    </nav>
  );
}
