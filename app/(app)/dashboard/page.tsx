import type { Metadata } from "next";

import { NAV_ITEMS } from "@/config/navigation";
import { hasPermission, requireActiveUser } from "@/lib/auth/current-user";
import { requirePagePermission } from "@/lib/auth/require-page-permission";
import { PageHeader } from "@/components/patterns/page-header";
import { DashboardView } from "@/app/(app)/dashboard/_components/dashboard-view";

const item = NAV_ITEMS.find((navItem) => navItem.href === "/dashboard")!;

export const metadata: Metadata = { title: item.label };

export default async function DashboardPage() {
  await requirePagePermission(item.permission);
  const user = await requireActiveUser();
  const canManage = hasPermission(user, "employees:manage");

  return (
    <div>
      <PageHeader title={item.label} description={item.description} />
      <DashboardView canManage={canManage} />
    </div>
  );
}
