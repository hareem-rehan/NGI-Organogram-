"use client";

import { useState } from "react";
import { Menu } from "lucide-react";

import type { NavItem } from "@/config/navigation";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { NavLinks } from "@/components/layout/nav-links";

interface MobileNavProps {
  items: readonly NavItem[];
}

export function MobileNav({ items }: MobileNavProps) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation menu">
          <Menu aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent title="Navigation" description="Jump to another section of the application.">
        <NavLinks items={items} onNavigate={() => setOpen(false)} className="mt-6" />
      </SheetContent>
    </Sheet>
  );
}
