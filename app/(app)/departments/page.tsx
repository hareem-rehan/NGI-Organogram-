import type { Metadata } from "next";

import { NAV_ITEMS } from "@/config/navigation";
import { hasPermission, requireActiveUser } from "@/lib/auth/current-user";
import { requirePagePermission } from "@/lib/auth/require-page-permission";
import { PageHeader } from "@/components/patterns/page-header";
import { DepartmentsView } from "@/app/(app)/departments/_components/departments-view";

const item = NAV_ITEMS.find((navItem) => navItem.href === "/departments")!;

export const metadata: Metadata = { title: item.label };

export default async function DepartmentsPage() {
  await requirePagePermission(item.permission);
  const user = await requireActiveUser();
  const canManage = hasPermission(user, "departments:manage");

  return (
    <div>
      <PageHeader title={item.label} description={item.description} />
      <DepartmentsView canManage={canManage} />
    </div>
  );
}
