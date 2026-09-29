/**
 * The name shown for each level in the Position form's Level dropdown
 * (docs/DECISIONS.md D32, D34). The most specific names win; otherwise the
 * standard name is used:
 *
 *   0. the chosen sub-division's own Levels-Mapping titles for that level
 *      (same ladder rule as below) — D34;
 *   1. the department's Levels-Mapping titles for that level — for the
 *      chosen ladder (IC or Manager) when one is chosen, else both ladders;
 *   2. the department's own job-grade name for that level (set when a
 *      position was created with a custom level name);
 *   3. the standard scale name (e.g. "Lead / Principal").
 */
export interface LevelTitleInput {
  departmentId: string;
  jobGradeCode: string;
  kind: "IC" | "MANAGER";
  title: string;
}

export interface SubDivisionLevelTitleInput {
  jobFamilyId: string;
  jobGradeCode: string;
  kind: "IC" | "MANAGER";
  title: string;
}

export interface JobGradeNameInput {
  departmentId: string | null;
  code: string;
  name: string;
}

export function levelNameFor(args: {
  code: string;
  defaultName: string;
  departmentId: string;
  kind: "IC" | "MANAGER" | null;
  levelTitles: readonly LevelTitleInput[];
  jobGrades: readonly JobGradeNameInput[];
  jobFamilyId?: string | null;
  subDivisionLevelTitles?: readonly SubDivisionLevelTitleInput[];
}): string {
  const { code, defaultName, departmentId, kind, levelTitles, jobGrades } = args;
  const matches = (t: { jobGradeCode: string; kind: "IC" | "MANAGER" }) =>
    t.jobGradeCode === code && (kind === null || t.kind === kind);

  if (args.jobFamilyId) {
    const own = joinTitles(
      (args.subDivisionLevelTitles ?? []).filter(
        (t) => t.jobFamilyId === args.jobFamilyId && matches(t)
      )
    );
    if (own) return own;
  }
  if (departmentId) {
    const own = joinTitles(
      levelTitles.filter((t) => t.departmentId === departmentId && matches(t))
    );
    if (own) return own;

    const deptGrade = jobGrades.find((g) => g.departmentId === departmentId && g.code === code);
    if (deptGrade?.name.trim() && deptGrade.name.trim() !== code) return deptGrade.name.trim();
  }
  return defaultName;
}

/** Distinct, trimmed, sorted titles joined with " / " — or null when none. */
function joinTitles(rows: readonly { title: string }[]): string | null {
  const titles = rows.map((t) => t.title.trim()).filter((t) => t.length > 0);
  const unique = [...new Set(titles)].sort((a, b) => a.localeCompare(b));
  return unique.length > 0 ? unique.join(" / ") : null;
}
