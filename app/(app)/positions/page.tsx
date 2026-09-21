import type { Metadata } from "next";

import { NAV_ITEMS } from "@/config/navigation";
import { hasPermission, requireActiveUser } from "@/lib/auth/current-user";
import { requirePagePermission } from "@/lib/auth/require-page-permission";
import { PageHeader } from "@/components/patterns/page-header";
import { PositionsView } from "@/app/(app)/positions/_components/positions-view";

const item = NAV_ITEMS.find((navItem) => navItem.href === "/positions")!;

export const metadata: Metadata = { title: item.label };

export default async function PositionsPage() {
  await requirePagePermission(item.permission);
  const user = await requireActiveUser();
  const canManage = hasPermission(user, "positions:manage");

  return (
    <div>
      <PageHeader title={item.label} description={item.description} />
      <PositionsView canManage={canManage} />
    </div>
  );
}
