/**
 * Pure UI-facing label logic — never a source of truth for eligibility
 * (that's always the server-side checks in lib/services/assignment.service.ts).
 * No Prisma import, kept unit-testable in isolation like the rest of
 * lib/domain (see lib/domain/assignment.ts).
 */
export type AssignmentDisplayStatus = "assigned" | "unassigned" | "future" | "terminated";

/**
 * Distinguishes four states a reader needs to see at a glance
 * (docs/phase-reports/PHASE_06_EMPLOYEES_AND_ASSIGNMENTS.md Step 13):
 * Currently Assigned, Unassigned, Future Assignment Scheduled, and
 * Employment Terminated — which takes priority, since a terminated
 * employee's assignment history isn't relevant to "are they currently
 * working here."
 */
export function assignmentDisplayStatus(
  employmentStatus: string,
  hasCurrentAssignment: boolean,
  hasFutureAssignment: boolean
): AssignmentDisplayStatus {
  if (employmentStatus === "TERMINATED") return "terminated";
  if (hasCurrentAssignment) return "assigned";
  if (hasFutureAssignment) return "future";
  return "unassigned";
}

export const ASSIGNMENT_STATUS_LABEL: Record<AssignmentDisplayStatus, string> = {
  assigned: "Currently Assigned",
  unassigned: "Unassigned",
  future: "Future Assignment Scheduled",
  terminated: "Employment Terminated",
};
