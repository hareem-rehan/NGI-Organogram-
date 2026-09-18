import type { Metadata } from "next";

import { PageHeader } from "@/components/patterns/page-header";
import { NAV_ITEMS } from "@/config/navigation";
import { requirePagePermission } from "@/lib/auth/require-page-permission";
import { AuditLogView } from "@/app/(app)/audit-log/_components/audit-log-view";

const item = NAV_ITEMS.find((navItem) => navItem.href === "/audit-log")!;

export const metadata: Metadata = { title: item.label };

export default async function AuditLogPage() {
  await requirePagePermission(item.permission);

  return (
    <div>
      <PageHeader title={item.label} description={item.description} />
      <AuditLogView />
    </div>
  );
}
