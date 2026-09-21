import { describe, expect, it } from "vitest";

import {
  JOB_GRADE_SCALE,
  gradeCodeForLevel,
  inferGradeCodeFromTitle,
  inferGradeLevelFromTitle,
  normalizeTitle,
} from "./job-grade-mapping";

describe("JOB_GRADE_SCALE", () => {
  it("covers L2 to L18 with no gaps, ascending", () => {
    expect(JOB_GRADE_SCALE.map((g) => g.level)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
    ]);
  });

  it("uses the level as the code suffix, so L7 really is level 7", () => {
    for (const grade of JOB_GRADE_SCALE) {
      expect(grade.code).toBe(`L${grade.level}`);
    }
  });

  it("maps a level back to its code", () => {
    expect(gradeCodeForLevel(7)).toBe("L7");
    expect(gradeCodeForLevel(18)).toBe("L18");
    expect(gradeCodeForLevel(99)).toBeNull();
  });
});

describe("normalizeTitle", () => {
  it("expands the abbreviations that appear in the real org chart", () => {
    expect(normalizeTitle("Sr. Software Engineer")).toBe("senior software engineer");
    expect(normalizeTitle("Asst. Director Of Engineering")).toBe(
      "assistant director of engineering"
    );
    expect(normalizeTitle("Head of IT & Ops.")).toBe("head of it and operations");
  });

  it("is punctuation and whitespace insensitive", () => {
    expect(normalizeTitle("  QA / QAA  ")).toBe("qa qaa");
    expect(normalizeTitle("UI/UX Engineer")).toBe("ui ux engineer");
  });
});

describe("inferGradeLevelFromTitle — the L7 boundary that decides the chart", () => {
  it.each([
    ["Tech Lead", 7],
    ["Principal Software Engineer", 7],
    ["Project Manager", 7],
  ])("%s is L%i (shown)", (title, level) => {
    expect(inferGradeLevelFromTitle(title)).toBe(level);
  });

  it.each([
    ["Associate Tech Lead", 6],
    ["Senior Software Engineer II", 6],
    ["Senior Software Engineer", 5],
    ["Software Engineer II", 4],
    ["Software Engineer", 3],
    ["Associate Software Engineer", 2],
  ])("%s is L%i (hidden at an L7 threshold)", (title, level) => {
    expect(inferGradeLevelFromTitle(title)).toBe(level);
  });
});

describe("inferGradeLevelFromTitle — specific rules beat general ones", () => {
  it.each([
    ["Senior Tech Lead", 8],
    ["Tech Lead", 7],
    ["Associate Tech Lead", 6],
  ])("%s -> L%i", (title, level) => {
    expect(inferGradeLevelFromTitle(title)).toBe(level);
  });

  it.each([
    ["Senior Director", 13],
    ["Director", 12],
    ["Associate Director", 11],
    ["Asst. Director Of Engineering", 11],
  ])("%s -> L%i", (title, level) => {
    expect(inferGradeLevelFromTitle(title)).toBe(level);
  });

  it.each([
    ["Senior VP", 16],
    ["VP of Engineering", 15],
    ["Associate VP", 14],
  ])("%s -> L%i", (title, level) => {
    expect(inferGradeLevelFromTitle(title)).toBe(level);
  });

  it.each([
    ["Senior Solution Architect", 12],
    ["Solution Architect", 11],
    ["Architect", 10],
    ["Associate Architect", 9],
  ])("%s -> L%i", (title, level) => {
    expect(inferGradeLevelFromTitle(title)).toBe(level);
  });

  it.each([
    ["Sr. Manager Admin", 10],
    ["Manager HR", 10],
    ["Associate Manager", 9],
    ["Assistant Manager HR", 9],
  ])("%s -> L%i", (title, level) => {
    expect(inferGradeLevelFromTitle(title)).toBe(level);
  });
});

describe("inferGradeLevelFromTitle — C-suite from the real chart", () => {
  it.each([
    ["CEO", 18],
    ["CTO", 18],
    ["COO", 18],
    ["CFO", 18],
    ["CHO / CPO", 18],
  ])("%s -> L%i", (title, level) => {
    expect(inferGradeLevelFromTitle(title)).toBe(level);
  });
});

describe("inferGradeLevelFromTitle — matches whole words, never substrings", () => {
  // "director" literally contains "cto". An earlier substring-based
  // implementation promoted every Director to C-suite (L18) because of it.
  it("does not read a C-suite abbreviation out of the middle of a longer word", () => {
    expect(inferGradeLevelFromTitle("Director")).toBe(12);
    expect(inferGradeLevelFromTitle("Director Of Engineering")).toBe(12);
    expect(inferGradeLevelFromTitle("Associate Director")).toBe(11);
  });

  // The generic `manager` rule (L10) must not swallow the more specific
  // project/product rules that sit at other levels.
  it("does not let the generic manager rule swallow a more specific one", () => {
    expect(inferGradeLevelFromTitle("Project Manager")).toBe(7);
    expect(inferGradeLevelFromTitle("Delivery Manager")).toBe(10);
    expect(inferGradeLevelFromTitle("Associate Delivery Manager")).toBe(9);
    expect(inferGradeLevelFromTitle("Product Manager")).toBe(6);
  });
});

describe("inferGradeLevelFromTitle — unmatched titles", () => {
  it("returns null rather than guessing, so a human reviews it", () => {
    expect(inferGradeLevelFromTitle("Delivery Org / Administration")).toBeNull();
    expect(inferGradeLevelFromTitle("")).toBeNull();
    expect(inferGradeLevelFromTitle("Backend")).toBeNull();
  });
});

describe("inferGradeCodeFromTitle", () => {
  it("returns the code form used by the CSV import's jobGradeCode column", () => {
    expect(inferGradeCodeFromTitle("Tech Lead")).toBe("L7");
    expect(inferGradeCodeFromTitle("CEO")).toBe("L18");
    expect(inferGradeCodeFromTitle("Backend")).toBeNull();
  });
});
