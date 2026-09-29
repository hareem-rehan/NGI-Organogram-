import type { CareerTrackKind } from "@prisma/client";

/**
 * Which column groups the Levels Mapping grid shows, and in what order
 * (docs/DECISIONS.md D34). HR picks the groups: any department, and any
 * sub-division (shown right after its department). Pure — no DB, no React.
 */

export interface ColumnDepartment {
  id: string;
  name: string;
  hasIcLadder: boolean;
  hasManagerLadder: boolean;
  showInLevelsMapping: boolean;
}

export interface ColumnSubDivision {
  id: string;
  name: string;
  departmentId: string;
  showInLevelsMapping: boolean;
}

export interface LevelsMappingColumnGroup {
  type: "DEPARTMENT" | "SUB_DIVISION";
  id: string;
  name: string;
  /** The department the group belongs to (itself, for a department). */
  departmentId: string;
  departmentName: string;
  ladders: CareerTrackKind[];
}

/**
 * The ladders a group's columns cover: the department's own ladders. A
 * department that runs neither (e.g. Founder) still gets both once HR adds
 * it — they asked to map it, so give them somewhere to type.
 */
export function laddersForDepartment(department: ColumnDepartment): CareerTrackKind[] {
  const ladders: CareerTrackKind[] = [];
  if (department.hasIcLadder) ladders.push("IC");
  if (department.hasManagerLadder) ladders.push("MANAGER");
  return ladders.length > 0 ? ladders : ["IC", "MANAGER"];
}

/**
 * Visible groups, in department order (as given), each department followed
 * by its visible sub-divisions (as given). A visible sub-division under a
 * hidden department still shows — hiding one never hides the other.
 */
export function buildLevelsMappingColumns(
  departments: readonly ColumnDepartment[],
  subDivisions: readonly ColumnSubDivision[]
): LevelsMappingColumnGroup[] {
  const groups: LevelsMappingColumnGroup[] = [];
  for (const department of departments) {
    const ladders = laddersForDepartment(department);
    if (department.showInLevelsMapping) {
      groups.push({
        type: "DEPARTMENT",
        id: department.id,
        name: department.name,
        departmentId: department.id,
        departmentName: department.name,
        ladders,
      });
    }
    for (const family of subDivisions) {
      if (family.departmentId !== department.id || !family.showInLevelsMapping) continue;
      groups.push({
        type: "SUB_DIVISION",
        id: family.id,
        name: family.name,
        departmentId: department.id,
        departmentName: department.name,
        ladders,
      });
    }
  }
  return groups;
}
