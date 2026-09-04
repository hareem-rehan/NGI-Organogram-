import type { Metadata } from "next";

import { hasPermission, requireActiveUser } from "@/lib/auth/current-user";
import { requirePagePermission } from "@/lib/auth/require-page-permission";
import { EmployeeDetailsView } from "@/app/(app)/employees/_components/employee-details-view";

export const metadata: Metadata = { title: "Employee Details" };

interface EmployeeDetailsPageProps {
  params: Promise<{ employeeId: string }>;
}

export default async function EmployeeDetailsPage({ params }: EmployeeDetailsPageProps) {
  await requirePagePermission("employees:view");
  const user = await requireActiveUser();
  const canManage = hasPermission(user, "employees:manage");
  const { employeeId } = await params;

  return <EmployeeDetailsView employeeId={employeeId} canManage={canManage} />;
}
