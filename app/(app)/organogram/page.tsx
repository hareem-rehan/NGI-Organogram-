import type { Metadata } from "next";
import { Suspense } from "react";

import { NAV_ITEMS } from "@/config/navigation";
import { hasPermission, requireActiveUser } from "@/lib/auth/current-user";
import { requirePagePermission } from "@/lib/auth/require-page-permission";
import { PageHeader } from "@/components/patterns/page-header";
import { LoadingState } from "@/components/patterns/loading-state";
import { OrganogramView } from "@/app/(app)/organogram/_components/organogram-view";

const item = NAV_ITEMS.find((navItem) => navItem.href === "/organogram")!;

export const metadata: Metadata = { title: item.label };

export default async function OrganogramPage() {
  await requirePagePermission(item.permission);
  const user = await requireActiveUser();

  return (
    <div>
      <PageHeader title={item.label} description={item.description} />
      <Suspense fallback={<LoadingState label="Loading organization chart…" />}>
        <OrganogramView
          canManage={hasPermission(user, "positions:manage")}
          canViewEmployeeDetails={hasPermission(user, "employees:view")}
          canExport={hasPermission(user, "exports:execute")}
        />
      </Suspense>
    </div>
  );
}
