import type { Metadata } from "next";

import { NAV_ITEMS } from "@/config/navigation";
import { hasPermission, requireActiveUser } from "@/lib/auth/current-user";
import { requirePagePermission } from "@/lib/auth/require-page-permission";
import { PageHeader } from "@/components/patterns/page-header";
import {
  listCareerTracksForCompany,
  listJobFamiliesForCompany,
  listLevelMappingEntriesForCompany,
} from "@/lib/repositories/career-framework.repository";
import { listDepartmentsForCompany } from "@/lib/repositories/department.repository";
import {
  getJobGradeUsageCounts,
  listJobGradesForCompany,
} from "@/lib/repositories/job-grade.repository";
import type { JobGradeUsageByCode } from "@/app/(app)/career-framework/actions";
import { CareerFrameworkView } from "@/app/(app)/career-framework/_components/career-framework-view";

const item = NAV_ITEMS.find((navItem) => navItem.href === "/career-framework")!;

export const metadata: Metadata = { title: item.label };

export default async function CareerFrameworkPage() {
  await requirePagePermission(item.permission);
  const user = await requireActiveUser();
  const canManage = hasPermission(user, "career:manage");

  // The career framework is company config; counts stay small, so load it
  // all server-side and hand it to the client view rather than paginating.
  const [jobFamilies, careerTracks, levelMappingEntries, departments, jobGrades, usageById] =
    await Promise.all([
      listJobFamiliesForCompany(user.companyId),
      listCareerTracksForCompany(user.companyId),
      listLevelMappingEntriesForCompany(user.companyId),
      listDepartmentsForCompany(user.companyId),
      listJobGradesForCompany(user.companyId),
      getJobGradeUsageCounts(user.companyId),
    ]);

  // Roll per-grade usage up to per-code for the Levels panel (matches the
  // deduped-by-code pickers).
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
      <CareerFrameworkView
        canManage={canManage}
        initialJobFamilies={jobFamilies}
        initialCareerTracks={careerTracks}
        initialLevelMappingEntries={levelMappingEntries}
        departments={departments.filter((d) => d.status === "ACTIVE")}
        jobGrades={jobGrades}
        initialLevelUsageByCode={levelUsageByCode}
      />
    </div>
  );
}
