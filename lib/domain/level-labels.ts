/**
 * The name shown for each level in the Position form's Level dropdown
 * (docs/DECISIONS.md D32). A department's OWN level names win when it has
 * them; otherwise the standard name is used:
 *
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
}): string {
  const { code, defaultName, departmentId, kind, levelTitles, jobGrades } = args;
  if (departmentId) {
    const titles = levelTitles
      .filter(
        (t) =>
          t.departmentId === departmentId &&
          t.jobGradeCode === code &&
          (kind === null || t.kind === kind)
      )
      .map((t) => t.title.trim())
      .filter((t) => t.length > 0);
    const unique = [...new Set(titles)].sort((a, b) => a.localeCompare(b));
    if (unique.length > 0) return unique.join(" / ");

    const deptGrade = jobGrades.find((g) => g.departmentId === departmentId && g.code === code);
    if (deptGrade?.name.trim() && deptGrade.name.trim() !== code) return deptGrade.name.trim();
  }
  return defaultName;
}
