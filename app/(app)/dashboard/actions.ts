"use server";

import { hasPermission, requirePermission } from "@/lib/auth/current-user";
import { runAction, type ActionResult } from "@/lib/server/action-result";
import { getDashboardSummary, type DashboardSummary } from "@/lib/services/dashboard.service";

/**
 * The dashboard's only read operation. No parameters accepted — Phase 7
 * ships no filters (docs/phase-reports/PHASE_07_DASHBOARD_AND_COMPANY_OVERVIEW.md
 * "Known Limitations"), so there is nothing here for a caller to
 * manipulate; `companyId` and the management-details visibility flag are
 * both derived exclusively from the authenticated session, never from
 * client input.
 */
export async function getDashboardAction(): Promise<ActionResult<DashboardSummary>> {
  return runAction(async () => {
    const user = await requirePermission("dashboard:view");
    return getDashboardSummary({
      companyId: user.companyId,
      canSeeManagementDetails: hasPermission(user, "employees:manage"),
    });
  });
}
