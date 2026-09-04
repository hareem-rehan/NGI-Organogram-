import type { Metadata } from "next";

import { PageHeader } from "@/components/patterns/page-header";
import { NAV_ITEMS } from "@/config/navigation";
import { requirePagePermission } from "@/lib/auth/require-page-permission";
import { UsersView } from "@/app/(app)/users/_components/users-view";

const item = NAV_ITEMS.find((navItem) => navItem.href === "/users")!;

export const metadata: Metadata = { title: item.label };

export default async function UsersPage() {
  await requirePagePermission(item.permission);

  return (
    <div>
      <PageHeader title={item.label} description={item.description} />
      <UsersView />
    </div>
  );
}
