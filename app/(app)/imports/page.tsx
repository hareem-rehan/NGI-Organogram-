import type { Metadata } from "next";

import { PageHeader } from "@/components/patterns/page-header";
import { NAV_ITEMS } from "@/config/navigation";
import { requirePagePermission } from "@/lib/auth/require-page-permission";
import { ImportView } from "@/app/(app)/imports/_components/import-view";

const item = NAV_ITEMS.find((navItem) => navItem.href === "/imports")!;

export const metadata: Metadata = { title: item.label };

export default async function ImportsPage() {
  await requirePagePermission(item.permission);

  return (
    <div>
      <PageHeader title={item.label} description={item.description} />
      <ImportView />
    </div>
  );
}
