import type { Metadata } from "next";

import { PageHeader } from "@/components/patterns/page-header";
import { NAV_ITEMS } from "@/config/navigation";
import { requireActiveUser } from "@/lib/auth/current-user";
import { requirePagePermission } from "@/lib/auth/require-page-permission";
import {
  getJobGradeUsageCounts,
  listJobGradesForCompany,
} from "@/lib/repositories/job-grade.repository";
import type { JobGradeUsageByCode } from "@/app/(app)/settings/actions";
import { SettingsView } from "@/app/(app)/settings/_components/settings-view";

const item = NAV_ITEMS.find((navItem) => navItem.href === "/settings")!;

export const metadata: Metadata = { title: item.label };

export default async function SettingsPage() {
  await requirePagePermission(item.permission);
  const user = await requireActiveUser();

  const [jobGrades, usageById] = await Promise.all([
    listJobGradesForCompany(user.companyId),
    getJobGradeUsageCounts(user.companyId),
  ]);
  const levelUsageByCode: JobGradeUsageByCode = {};
  for (const grade of jobGrades) {
    const u = usageById.get(grade.id);
    const bucket = (levelUsageByCode[grade.code] ??= { positionCount: 0, titleCount: 0 });
    if (u) {
      bucket.positionCount += u.positionCount;
      bucket.titleCount += u.titleCount;
    }
  }

  return (
    <div>
      <PageHeader title={item.label} description={item.description} />
      <SettingsView initialLevels={{ jobGrades, levelUsageByCode }} />
    </div>
  );
}
