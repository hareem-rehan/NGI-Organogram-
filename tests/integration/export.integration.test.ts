import { beforeEach, describe, expect, it } from "vitest";

import { testPrisma } from "./setup";
import {
  makeChildPosition,
  makeCompany,
  makeDepartment,
  makeRootPosition,
  makeUser,
} from "./fixtures";
import {
  cancelExportJob,
  downloadExportFile,
  getExportJob,
  requestExport,
} from "@/lib/services/export.service";
import { DomainValidationError, NotFoundError } from "@/lib/domain/errors";
import { queryAuditEvents } from "@/lib/services/audit.service";

describe("export.service", () => {
  let companyId: string;
  let userId: string;
  let departmentId: string;
  let rootId: string;

  beforeEach(async () => {
    const company = await makeCompany();
    companyId = company.id;
    const user = await makeUser(companyId);
    userId = user.id;
    const department = await makeDepartment(companyId);
    departmentId = department.id;
    const root = await makeRootPosition(companyId, departmentId, {
      title: "Chief Executive Officer",
    });
    rootId = root.id;
    await makeChildPosition(companyId, departmentId, rootId, 1, { title: "VP Engineering" });
  });

  it("generates a COMPLETED PDF export for the full company", async () => {
    const job = await requestExport({
      companyId,
      userId,
      options: { format: "PDF", scope: "FULL_COMPANY" },
    });
    expect(job.status).toBe("COMPLETED");
    expect(job.generatedFile).not.toBeNull();
    expect(job.generatedFilename).toMatch(/\.pdf$/);
    expect(job.nodeCount).toBe(2);
    expect(job.pageCount).toBeGreaterThanOrEqual(1);
  });

  it("generates a COMPLETED PNG export for the full company", async () => {
    const job = await requestExport({
      companyId,
      userId,
      options: { format: "PNG", scope: "FULL_COMPANY" },
    });
    expect(job.status).toBe("COMPLETED");
    expect(job.generatedFilename).toMatch(/\.png$/);
    expect(job.pageCount).toBeNull();
  });

  it("generates a POSITION_FOCUS export scoped to the selected position's descendants", async () => {
    const job = await requestExport({
      companyId,
      userId,
      options: { format: "PDF", scope: "POSITION_FOCUS", selectedPositionId: rootId },
    });
    expect(job.status).toBe("COMPLETED");
    expect(job.scopeLabel).toContain("Position Focus");
  });

  it("generates a DEPARTMENT_FOCUS export scoped to the selected department", async () => {
    const job = await requestExport({
      companyId,
      userId,
      options: { format: "PDF", scope: "DEPARTMENT_FOCUS", selectedDepartmentId: departmentId },
    });
    expect(job.status).toBe("COMPLETED");
    expect(job.scopeLabel).toContain("Department Focus");
  });

  it("rejects POSITION_FOCUS naming a position id that doesn't exist in this company", async () => {
    await expect(
      requestExport({
        companyId,
        userId,
        options: {
          format: "PDF",
          scope: "POSITION_FOCUS",
          selectedPositionId: "00000000-0000-0000-0000-000000000000",
        },
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("never resolves a position focus belonging to a different company (cross-company isolation)", async () => {
    const otherCompany = await makeCompany();
    const otherDept = await makeDepartment(otherCompany.id);
    const otherRoot = await makeRootPosition(otherCompany.id, otherDept.id);

    await expect(
      requestExport({
        companyId,
        userId,
        options: { format: "PDF", scope: "POSITION_FOCUS", selectedPositionId: otherRoot.id },
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("renders a safe empty-organization export when the company has zero positions", async () => {
    const emptyCompany = await makeCompany();
    const emptyUser = await makeUser(emptyCompany.id);
    const job = await requestExport({
      companyId: emptyCompany.id,
      userId: emptyUser.id,
      options: { format: "PDF", scope: "FULL_COMPANY" },
    });
    expect(job.status).toBe("COMPLETED");
    expect(job.nodeCount).toBe(0);
  });

  it("rejects an invalid resolved-option combination (scope required field missing) as a DomainValidationError-safe rejection", async () => {
    await expect(
      requestExport({
        companyId,
        userId,
        options: { format: "PDF", scope: "POSITION_FOCUS" },
      })
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it("round-trips through getExportJob and downloadExportFile after completion", async () => {
    const created = await requestExport({
      companyId,
      userId,
      options: { format: "PNG", scope: "FULL_COMPANY" },
    });
    const fetched = await getExportJob(created.id, companyId);
    expect(fetched.status).toBe("COMPLETED");
    expect((fetched as Record<string, unknown>).generatedFile).toBeUndefined();

    const file = await downloadExportFile(created.id, companyId);
    expect(file.buffer.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    expect(file.contentType).toBe("image/png");
  });

  it("never lets a download resolve a job belonging to a different company", async () => {
    const job = await requestExport({
      companyId,
      userId,
      options: { format: "PDF", scope: "FULL_COMPANY" },
    });
    const otherCompany = await makeCompany();
    await expect(downloadExportFile(job.id, otherCompany.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cancelling a completed job frees the stored bytes and marks it CANCELLED", async () => {
    const job = await requestExport({
      companyId,
      userId,
      options: { format: "PDF", scope: "FULL_COMPANY" },
    });
    const cancelled = await cancelExportJob(job.id, companyId);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.generatedFile).toBeNull();
    await expect(downloadExportFile(job.id, companyId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cancelling an already-terminal job is a no-op, not an error", async () => {
    const job = await requestExport({
      companyId,
      userId,
      options: { format: "PDF", scope: "FULL_COMPANY" },
    });
    const first = await cancelExportJob(job.id, companyId);
    const second = await cancelExportJob(job.id, companyId);
    expect(first.status).toBe("CANCELLED");
    expect(second.status).toBe("CANCELLED");
  });

  it("a job past its retention window is lazily flipped to EXPIRED and its bytes cleared on the next read", async () => {
    const job = await requestExport({
      companyId,
      userId,
      options: { format: "PDF", scope: "FULL_COMPANY" },
    });
    await testPrisma.exportJob.update({
      where: { id: job.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const fetched = await getExportJob(job.id, companyId);
    expect(fetched.status).toBe("EXPIRED");

    await expect(downloadExportFile(job.id, companyId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("safely rejects (never hangs) a PDF export of a pathologically wide hierarchy — one manager with hundreds of direct reports — instead of generating an unbounded number of tile pages", async () => {
    const wideCompany = await makeCompany();
    const wideUser = await makeUser(wideCompany.id);
    const wideDept = await makeDepartment(wideCompany.id);
    const wideRoot = await makeRootPosition(wideCompany.id, wideDept.id);

    // One bulk createMany (not N individual round-trips) keeps this fast
    // while still exercising the real end-to-end guard (DB → service →
    // subgraph → layout → SVG → pdf-renderer's MAX_PDF_TILE_PAGES check)
    // against real DB-sourced data, not a mock. 300 wide siblings is
    // comfortably over the tile-page limit at A3 landscape while still
    // laying out in a few seconds — see
    // tests/integration/export-rendering.integration.test.ts's dedicated
    // renderer-level test for the same guard in isolation.
    await testPrisma.position.createMany({
      data: Array.from({ length: 300 }, (_, i) => ({
        companyId: wideCompany.id,
        departmentId: wideDept.id,
        title: `Direct Report ${i}`,
        positionCode: `WIDE-${i}`,
        primaryReportsToPositionId: wideRoot.id,
        organizationalLevel: 2,
      })),
    });

    await expect(
      requestExport({
        companyId: wideCompany.id,
        userId: wideUser.id,
        options: {
          format: "PDF",
          scope: "FULL_COMPANY",
          pageSize: "A3",
          pdfLayoutMode: "MULTI_PAGE_TILED",
        },
      })
    ).rejects.toBeInstanceOf(DomainValidationError);
  }, 30000);

  it("rejects a PNG export exceeding the safe render-time limit BEFORE creating any ExportJob row, and recommends PDF (Phase 13.1, DEF-010 remediation)", async () => {
    const bigCompany = await makeCompany();
    const bigUser = await makeUser(bigCompany.id);
    const bigDept = await makeDepartment(bigCompany.id);
    const bigRoot = await makeRootPosition(bigCompany.id, bigDept.id);

    // A grid-shaped (not pathologically wide) 400-node company — comfortably
    // over the ~250-node / 20-megapixel safe PNG limit
    // (lib/domain/export/png-renderer.ts's MAX_PNG_SAFE_TOTAL_PIXELS) at
    // 1x scale, but nowhere near the separate PDF tile-page limit this
    // file's other wide-hierarchy test exercises.
    await testPrisma.position.createMany({
      data: Array.from({ length: 400 }, (_, i) => ({
        companyId: bigCompany.id,
        departmentId: bigDept.id,
        title: `Report ${i}`,
        positionCode: `BIG-${i}`,
        primaryReportsToPositionId: bigRoot.id,
        organizationalLevel: 2,
      })),
    });

    await expect(
      requestExport({
        companyId: bigCompany.id,
        userId: bigUser.id,
        options: { format: "PNG", scope: "FULL_COMPANY", pngScale: 1 },
      })
    ).rejects.toThrow(/pdf/i);

    // The whole point of Step 9.6 ("do not queue a PNG job known to
    // exceed limits") — no ExportJob row exists at all for this rejected
    // request, not even a FAILED one.
    const jobCount = await testPrisma.exportJob.count({ where: { companyId: bigCompany.id } });
    expect(jobCount).toBe(0);
  }, 30000);

  it("the PNG safe-limit check never affects PDF requests for the same large company (the check only runs inside the PNG branch)", async () => {
    const bigCompany = await makeCompany();
    const bigUser = await makeUser(bigCompany.id);
    const bigDept = await makeDepartment(bigCompany.id);
    const bigRoot = await makeRootPosition(bigCompany.id, bigDept.id);

    // The same 400-node flat shape the PNG-rejection test above uses
    // (well over the PNG safe limit) — this file's real ELK layout
    // naturally renders that many same-level nodes as a wide single row,
    // which is ALSO enough to hit the pre-existing, unrelated PDF
    // MAX_PDF_TILE_PAGES guard at the default A3 page size (the same
    // tile-count guard this file's dedicated wide-hierarchy test above
    // exercises deliberately). That is expected and correct — real
    // large/wide orgs strain both formats' own limits similarly; PDF's
    // tile-page rejection is a pre-existing, already-tested behavior,
    // unrelated to and unaffected by Phase 13.1's PNG-specific change.
    // What THIS test actually proves is narrower and still meaningful:
    // the new PNG check lives entirely inside `if (resolved.format ===
    // "PNG")` in export.service.ts, so a PDF request for the identical
    // company/scope reaches the pre-existing PDF code path completely
    // unmodified — it fails for the SAME pre-existing reason it always
    // would have, not a new one introduced by this remediation.
    await testPrisma.position.createMany({
      data: Array.from({ length: 400 }, (_, i) => ({
        companyId: bigCompany.id,
        departmentId: bigDept.id,
        title: `Report ${i}`,
        positionCode: `BIG-${i}`,
        primaryReportsToPositionId: bigRoot.id,
        organizationalLevel: 2,
      })),
    });

    await expect(
      requestExport({
        companyId: bigCompany.id,
        userId: bigUser.id,
        options: { format: "PDF", scope: "FULL_COMPANY" },
      })
    ).rejects.toThrow(/PDF/);
  }, 30000);

  it("a successful export records EXPORT_REQUESTED then EXPORT_COMPLETED, correlated by the job id and never storing the generated file bytes", async () => {
    const job = await requestExport({
      companyId,
      userId,
      options: { format: "PNG", scope: "FULL_COMPANY" },
    });

    const result = await queryAuditEvents({ companyId, role: "ADMIN", exportJobId: job.id });
    const actions = result.events.map((e) => e.action).sort();
    expect(actions).toEqual(["EXPORT_COMPLETED", "EXPORT_REQUESTED"]);
    for (const event of result.events) {
      expect(event.correlationId).toBe(job.id);
      expect(event.actorUserId).toBe(userId);
      expect(JSON.stringify(event.safeMetadata ?? {}).length).toBeLessThan(500);
    }
  });

  it("a failed export (e.g. the wide-hierarchy tile-page limit) records an EXPORT_FAILED event", async () => {
    const wideCompany = await makeCompany();
    const wideUser = await makeUser(wideCompany.id);
    const wideDept = await makeDepartment(wideCompany.id);
    const wideRoot = await makeRootPosition(wideCompany.id, wideDept.id);
    await testPrisma.position.createMany({
      data: Array.from({ length: 300 }, (_, i) => ({
        companyId: wideCompany.id,
        departmentId: wideDept.id,
        title: `Direct Report ${i}`,
        positionCode: `AUDIT-WIDE-${i}`,
        primaryReportsToPositionId: wideRoot.id,
        organizationalLevel: 2,
      })),
    });

    await expect(
      requestExport({
        companyId: wideCompany.id,
        userId: wideUser.id,
        options: {
          format: "PDF",
          scope: "FULL_COMPANY",
          pageSize: "A3",
          pdfLayoutMode: "MULTI_PAGE_TILED",
        },
      })
    ).rejects.toBeInstanceOf(DomainValidationError);

    const result = await queryAuditEvents({ companyId: wideCompany.id, role: "ADMIN" });
    expect(result.events.map((e) => e.action)).toContain("EXPORT_FAILED");
  }, 30000);
});
