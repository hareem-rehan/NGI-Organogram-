import type { Metadata } from "next";

import { NAV_ITEMS } from "@/config/navigation";
import { hasPermission, requireActiveUser } from "@/lib/auth/current-user";
import { requirePagePermission } from "@/lib/auth/require-page-permission";
import { PageHeader } from "@/components/patterns/page-header";
import { listDepartmentsForCompany } from "@/lib/repositories/department.repository";
import { listJobFamiliesForCompany } from "@/lib/repositories/career-framework.repository";
import { listDepartmentLevelTitlesForCompany } from "@/lib/repositories/department-level-title.repository";
import { listJobFamilyLevelTitlesForCompany } from "@/lib/repositories/job-family-level-title.repository";
import { LevelsMappingView } from "@/app/(app)/levels-mapping/_components/levels-mapping-view";

const item = NAV_ITEMS.find((navItem) => navItem.href === "/levels-mapping")!;

export const metadata: Metadata = { title: item.label };

export default async function LevelsMappingPage() {
  await requirePagePermission(item.permission);
  const user = await requireActiveUser();
  const canManage = hasPermission(user, "career:manage");

  // Company config; counts stay small, so load it all server-side and hand it
  // to the client view rather than paginating.
  const [departments, subDivisions, departmentTitles, subDivisionTitles] = await Promise.all([
    listDepartmentsForCompany(user.companyId),
    listJobFamiliesForCompany(user.companyId),
    listDepartmentLevelTitlesForCompany(user.companyId),
    listJobFamilyLevelTitlesForCompany(user.companyId),
  ]);

  return (
    <div>
      <PageHeader title={item.label} description={item.description} />
      <LevelsMappingView
        canManage={canManage}
        departments={departments.filter((d) => d.status === "ACTIVE")}
        subDivisions={subDivisions.filter((f) => f.status === "ACTIVE")}
        initialTitles={{ departmentTitles, subDivisionTitles }}
      />
    </div>
  );
}
