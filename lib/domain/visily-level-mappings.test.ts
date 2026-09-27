import { describe, expect, it } from "vitest";

import { JOB_GRADE_SCALE } from "./job-grade-mapping";
import {
  VISILY_DEPARTMENTS,
  VISILY_LEVEL_TITLES,
  type VisilyDepartment,
} from "./visily-level-mappings";

const SCALE_CODES = new Set(JOB_GRADE_SCALE.map((s) => s.code));
const CODES = new Set(VISILY_DEPARTMENTS.map((d) => d.code));

describe("VISILY_DEPARTMENTS", () => {
  it("has unique department codes", () => {
    expect(CODES.size).toBe(VISILY_DEPARTMENTS.length);
  });

  it("lists every parent before its children (safe create order)", () => {
    const seen = new Set<string>();
    for (const d of VISILY_DEPARTMENTS) {
      if (d.parentCode) expect(seen.has(d.parentCode)).toBe(true);
      seen.add(d.code);
    }
  });

  it("references only known parent codes", () => {
    for (const d of VISILY_DEPARTMENTS) {
      if (d.parentCode) expect(CODES.has(d.parentCode)).toBe(true);
    }
  });

  it("uses valid hex colours", () => {
    for (const d of VISILY_DEPARTMENTS) expect(d.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("only defines level titles for departments that enable that ladder", () => {
    const byCode = new Map<string, VisilyDepartment>(VISILY_DEPARTMENTS.map((d) => [d.code, d]));
    for (const [code, ladders] of Object.entries(VISILY_LEVEL_TITLES)) {
      const dept = byCode.get(code);
      expect(dept, `unknown department ${code}`).toBeDefined();
      if (ladders.IC) expect(dept!.hasIcLadder).toBe(true);
      if (ladders.MANAGER) expect(dept!.hasManagerLadder).toBe(true);
    }
  });
});

describe("VISILY_LEVEL_TITLES", () => {
  it("uses only valid level codes from the standard scale", () => {
    for (const ladders of Object.values(VISILY_LEVEL_TITLES)) {
      for (const rows of Object.values(ladders)) {
        for (const row of rows ?? []) expect(SCALE_CODES.has(row.jobGradeCode)).toBe(true);
      }
    }
  });

  it("has no duplicate (level, title) within a ladder", () => {
    for (const ladders of Object.values(VISILY_LEVEL_TITLES)) {
      for (const rows of Object.values(ladders)) {
        const keys = (rows ?? []).map((r) => `${r.jobGradeCode}|${r.title}`);
        expect(new Set(keys).size).toBe(keys.length);
      }
    }
  });
});
