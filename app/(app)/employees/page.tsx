import type { Metadata } from "next";

import { NAV_ITEMS } from "@/config/navigation";
import { hasPermission, requireActiveUser } from "@/lib/auth/current-user";
import { requirePagePermission } from "@/lib/auth/require-page-permission";
import { PageHeader } from "@/components/patterns/page-header";
import { EmployeesView } from "@/app/(app)/employees/_components/employees-view";

const item = NAV_ITEMS.find((navItem) => navItem.href === "/employees")!;

export const metadata: Metadata = { title: item.label };

export default async function EmployeesPage() {
  await requirePagePermission(item.permission);
  const user = await requireActiveUser();
  const canManage = hasPermission(user, "employees:manage");

  return (
    <div>
      <PageHeader title={item.label} description={item.description} />
      <EmployeesView canManage={canManage} />
    </div>
  );
}
