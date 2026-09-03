import type { Metadata } from "next";

import { PageHeader } from "@/components/patterns/page-header";
import { NAV_ITEMS } from "@/config/navigation";
import { requirePagePermission } from "@/lib/auth/require-page-permission";
import { SettingsView } from "@/app/(app)/settings/_components/settings-view";

const item = NAV_ITEMS.find((navItem) => navItem.href === "/settings")!;

export const metadata: Metadata = { title: item.label };

export default async function SettingsPage() {
  await requirePagePermission(item.permission);

  return (
    <div>
      <PageHeader title={item.label} description={item.description} />
      <SettingsView />
    </div>
  );
}
