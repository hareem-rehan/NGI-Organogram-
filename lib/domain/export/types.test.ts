import { describe, expect, it } from "vitest";

import { ExportOptionsError, resolveExportOptions } from "./types";

describe("resolveExportOptions", () => {
  it("resolves a minimal FULL_COMPANY PDF request to full defaults", () => {
    const resolved = resolveExportOptions({ format: "PDF", scope: "FULL_COMPANY" });
    expect(resolved).toEqual({
      format: "PDF",
      scope: "FULL_COMPANY",
      selectedPositionId: null,
      selectedDepartmentId: null,
      descendantDepth: 2,
      includePlanned: true,
      filters: { departmentIds: [], levels: [], jobGradeIds: [], occupancy: "all", statuses: [] },
      pageSize: "A3",
      pdfLayoutMode: "AUTO",
      pngScale: 2,
      includeLegend: true,
      includeMetadata: true,
      includeConfidentialityLabel: true,
    });
  });

  it("rejects an unsupported format", () => {
    expect(() => resolveExportOptions({ format: "JPEG" as never, scope: "FULL_COMPANY" })).toThrow(
      ExportOptionsError
    );
  });

  it("rejects an unsupported scope", () => {
    expect(() => resolveExportOptions({ format: "PDF", scope: "NONSENSE" as never })).toThrow(
      ExportOptionsError
    );
  });

  it("requires selectedPositionId for POSITION_FOCUS", () => {
    try {
      resolveExportOptions({ format: "PNG", scope: "POSITION_FOCUS" });
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ExportOptionsError);
      expect((error as ExportOptionsError).field).toBe("selectedPositionId");
    }
  });

  it("requires selectedDepartmentId for DEPARTMENT_FOCUS", () => {
    try {
      resolveExportOptions({ format: "PNG", scope: "DEPARTMENT_FOCUS" });
      expect.fail("should have thrown");
    } catch (error) {
      expect((error as ExportOptionsError).field).toBe("selectedDepartmentId");
    }
  });

  it("ignores a selectedDepartmentId provided for a POSITION_FOCUS request (scope-appropriate field only)", () => {
    const resolved = resolveExportOptions({
      format: "PNG",
      scope: "POSITION_FOCUS",
      selectedPositionId: "pos-1",
      selectedDepartmentId: "dept-1",
    });
    expect(resolved.selectedDepartmentId).toBeNull();
    expect(resolved.selectedPositionId).toBe("pos-1");
  });

  it("rejects an invalid descendantDepth", () => {
    expect(() =>
      resolveExportOptions({
        format: "PNG",
        scope: "POSITION_FOCUS",
        selectedPositionId: "pos-1",
        descendantDepth: 7 as never,
      })
    ).toThrow(ExportOptionsError);
  });

  it("rejects an invalid PDF page size", () => {
    expect(() =>
      resolveExportOptions({ format: "PDF", scope: "FULL_COMPANY", pageSize: "Legal" as never })
    ).toThrow(ExportOptionsError);
  });

  it("rejects an invalid PDF layout mode", () => {
    expect(() =>
      resolveExportOptions({
        format: "PDF",
        scope: "FULL_COMPANY",
        pdfLayoutMode: "WEIRD" as never,
      })
    ).toThrow(ExportOptionsError);
  });

  it("rejects an excessive PNG scale", () => {
    expect(() =>
      resolveExportOptions({ format: "PNG", scope: "FULL_COMPANY", pngScale: 10 as never })
    ).toThrow(ExportOptionsError);
  });

  it("rejects an invalid occupancy filter", () => {
    expect(() =>
      resolveExportOptions({
        format: "PDF",
        scope: "FULL_COMPANY",
        filters: {
          departmentIds: [],
          levels: [],
          jobGradeIds: [],
          occupancy: "nonsense" as never,
          statuses: [],
        },
      })
    ).toThrow(ExportOptionsError);
  });

  it("rejects an invalid status filter value", () => {
    expect(() =>
      resolveExportOptions({
        format: "PDF",
        scope: "FULL_COMPANY",
        filters: {
          departmentIds: [],
          levels: [],
          jobGradeIds: [],
          occupancy: "all",
          statuses: ["DELETED" as never],
        },
      })
    ).toThrow(ExportOptionsError);
  });

  it("accepts CURRENT_VIEW scope with no focus id required", () => {
    expect(() => resolveExportOptions({ format: "PDF", scope: "CURRENT_VIEW" })).not.toThrow();
  });
});
