import { describe, expect, it } from "vitest";

import { levelNameFor, type LevelTitleInput } from "./level-labels";

const ENG = "dept-eng";
const HR = "dept-hr";
const titles: LevelTitleInput[] = [
  { departmentId: ENG, jobGradeCode: "L7", kind: "IC", title: "Principal Engineer" },
  { departmentId: ENG, jobGradeCode: "L7", kind: "MANAGER", title: "Engineering Manager" },
  { departmentId: ENG, jobGradeCode: "L7", kind: "IC", title: "Architect" },
  { departmentId: HR, jobGradeCode: "L7", kind: "MANAGER", title: "HR Manager" },
];
const base = { code: "L7", defaultName: "Lead / Principal", levelTitles: titles, jobGrades: [] };

describe("levelNameFor (Add Position level names)", () => {
  it("uses the department's Levels-Mapping names for the chosen ladder", () => {
    expect(levelNameFor({ ...base, departmentId: ENG, kind: "IC" })).toBe(
      "Architect / Principal Engineer"
    );
    expect(levelNameFor({ ...base, departmentId: ENG, kind: "MANAGER" })).toBe(
      "Engineering Manager"
    );
  });

  it("shows both ladders' names when no ladder is chosen", () => {
    expect(levelNameFor({ ...base, departmentId: ENG, kind: null })).toBe(
      "Architect / Engineering Manager / Principal Engineer"
    );
  });

  it("never borrows another department's names", () => {
    expect(levelNameFor({ ...base, departmentId: "dept-other", kind: null })).toBe(
      "Lead / Principal"
    );
    expect(levelNameFor({ ...base, departmentId: HR, kind: "IC" })).toBe("Lead / Principal");
  });

  it("falls back to the department's own grade name, then the default", () => {
    const jobGrades = [
      { departmentId: HR, code: "L5", name: "HR Specialist" },
      { departmentId: null, code: "L5", name: "Company-wide name" },
    ];
    expect(
      levelNameFor({
        ...base,
        code: "L5",
        defaultName: "Senior",
        departmentId: HR,
        kind: null,
        jobGrades,
      })
    ).toBe("HR Specialist");
    expect(
      levelNameFor({
        ...base,
        code: "L5",
        defaultName: "Senior",
        departmentId: ENG,
        kind: null,
        jobGrades,
      })
    ).toBe("Senior");
  });

  it("uses the default when no department is chosen", () => {
    expect(levelNameFor({ ...base, departmentId: "", kind: null })).toBe("Lead / Principal");
  });

  describe("sub-division names (D34)", () => {
    const QA = "fam-qa";
    const subDivisionLevelTitles = [
      { jobFamilyId: QA, jobGradeCode: "L7", kind: "IC" as const, title: "QA Architect" },
      { jobFamilyId: QA, jobGradeCode: "L7", kind: "MANAGER" as const, title: "QA Manager" },
      { jobFamilyId: "fam-other", jobGradeCode: "L7", kind: "IC" as const, title: "Other" },
    ];

    it("prefers the chosen sub-division's own names over the department's", () => {
      expect(
        levelNameFor({
          ...base,
          departmentId: ENG,
          kind: "IC",
          jobFamilyId: QA,
          subDivisionLevelTitles,
        })
      ).toBe("QA Architect");
      expect(
        levelNameFor({
          ...base,
          departmentId: ENG,
          kind: null,
          jobFamilyId: QA,
          subDivisionLevelTitles,
        })
      ).toBe("QA Architect / QA Manager");
    });

    it("falls back to the department's names when the sub-division has none for that level", () => {
      expect(
        levelNameFor({
          ...base,
          code: "L7",
          departmentId: ENG,
          kind: "IC",
          jobFamilyId: "fam-empty",
          subDivisionLevelTitles,
        })
      ).toBe("Architect / Principal Engineer");
    });

    it("falls back when the sub-division only has the other ladder's name", () => {
      expect(
        levelNameFor({
          ...base,
          departmentId: HR,
          kind: "MANAGER",
          jobFamilyId: "fam-other",
          subDivisionLevelTitles,
        })
      ).toBe("HR Manager");
    });
  });
});
