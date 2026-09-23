import { describe, expect, it } from "vitest";

import { PMF_TRACKS, PMF_TRACK_KEYS, getPmfTrack, pmfLadderEntries } from "./pmf-role-catalog";

describe("PMF role catalogue", () => {
  it("exposes the five tracks", () => {
    expect(PMF_TRACK_KEYS).toEqual(["ENGINEERING", "PROJECT", "PRODUCT", "HR", "IT"]);
  });

  it("Engineering and Product run both an IC and a Manager ladder", () => {
    for (const key of ["ENGINEERING", "PRODUCT"] as const) {
      const t = getPmfTrack(key)!;
      expect(pmfLadderEntries(t, "ic").length).toBeGreaterThan(0);
      expect(pmfLadderEntries(t, "manager").length).toBeGreaterThan(0);
    }
  });

  it("Project, HR and IT run a manager ladder only", () => {
    for (const key of ["PROJECT", "HR", "IT"] as const) {
      const t = getPmfTrack(key)!;
      expect(pmfLadderEntries(t, "ic")).toHaveLength(0);
      expect(pmfLadderEntries(t, "manager").length).toBeGreaterThan(0);
    }
  });

  it("keys every title by a valid L-code and never leaves a title blank", () => {
    for (const track of PMF_TRACKS) {
      for (const ladder of ["ic", "manager"] as const) {
        for (const { levelCode, title } of pmfLadderEntries(track, ladder)) {
          expect(levelCode).toMatch(/^L(1[0-8]|[2-9])$/);
          expect(title.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("carries the known signature titles from the reference", () => {
    const eng = getPmfTrack("ENGINEERING")!;
    expect(eng.ic?.L7).toBe("Principal Software Engineer");
    expect(eng.manager?.L7).toBe("Tech Lead");
    expect(getPmfTrack("HR")!.manager?.L7).toBe("HR Manager");
    expect(getPmfTrack("IT")!.manager?.L7).toBe("IT Manager");
    expect(getPmfTrack("PROJECT")!.manager?.L10).toBe("Delivery Manager");
  });
});
