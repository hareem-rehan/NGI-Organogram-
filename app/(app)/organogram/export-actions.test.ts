import { afterEach, describe, expect, it, vi } from "vitest";

const { requirePermissionMock, serviceMocks } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  serviceMocks: {
    requestExport: vi.fn(),
    getExportJob: vi.fn(),
    listExportJobs: vi.fn(),
    cancelExportJob: vi.fn(),
    downloadExportFile: vi.fn(),
    // Real implementation (not a stub) — export-actions.ts relies on its
    // actual field-stripping behavior, not just its call signature.
    omitGeneratedFile: (job: Record<string, unknown>) => {
      const { generatedFile: _generatedFile, ...safe } = job;
      return safe;
    },
  },
}));

vi.mock("@/lib/auth/current-user", () => ({ requirePermission: requirePermissionMock }));
vi.mock("@/lib/services/export.service", () => serviceMocks);

import { ForbiddenError, UnauthenticatedError } from "@/lib/auth/errors";
import {
  cancelExportJobAction,
  downloadExportFileAction,
  getExportJobAction,
  listExportJobsAction,
  requestExportAction,
} from "./export-actions";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_USER = { id: "u_1", role: "ADMIN", companyId: "company-trusted", status: "ACTIVE" };

const BASE_JOB = {
  id: JOB_ID,
  companyId: "company-trusted",
  requestedByUserId: "u_1",
  format: "PDF" as const,
  scope: "FULL_COMPANY" as const,
  optionsSnapshot: {},
  scopeLabel: "Full Company",
  nodeCount: 3,
  status: "COMPLETED" as const,
  generatedFilename: "organogram.pdf",
  fileSize: 1234,
  pageCount: 1,
  errorMessage: null,
  completedAt: new Date(),
  expiresAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("export server actions — authorization", () => {
  const invocations: [string, () => Promise<unknown>, keyof typeof serviceMocks][] = [
    [
      "requestExportAction",
      () => requestExportAction({ format: "PDF", scope: "FULL_COMPANY" }),
      "requestExport",
    ],
    ["getExportJobAction", () => getExportJobAction({ jobId: JOB_ID }), "getExportJob"],
    ["listExportJobsAction", () => listExportJobsAction(), "listExportJobs"],
    ["cancelExportJobAction", () => cancelExportJobAction({ jobId: JOB_ID }), "cancelExportJob"],
    [
      "downloadExportFileAction",
      () => downloadExportFileAction({ jobId: JOB_ID }),
      "downloadExportFile",
    ],
  ];

  for (const [name, invoke, serviceKey] of invocations) {
    it(`${name} requires exports:execute and never reaches the service layer for a VIEWER-role rejection`, async () => {
      requirePermissionMock.mockRejectedValue(new ForbiddenError());

      const result = await invoke();

      expect(result).toEqual({
        ok: false,
        error: "You don't have permission to do that.",
        authRedirect: "/access-denied",
      });
      expect(serviceMocks[serviceKey]).not.toHaveBeenCalled();
    });

    it(`${name} blocks an unauthenticated caller before the service layer ever runs`, async () => {
      requirePermissionMock.mockRejectedValue(new UnauthenticatedError());

      const result = (await invoke()) as { ok: boolean; authRedirect?: string };

      expect(result.ok).toBe(false);
      expect(result.authRedirect).toBe("/sign-in");
      expect(serviceMocks[serviceKey]).not.toHaveBeenCalled();
    });
  }

  it("requestExportAction checks exports:execute specifically", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    serviceMocks.requestExport.mockResolvedValue(BASE_JOB);

    await requestExportAction({ format: "PDF", scope: "FULL_COMPANY" });

    expect(requirePermissionMock).toHaveBeenCalledWith("exports:execute");
  });
});

describe("requestExportAction", () => {
  it("never returns the raw file bytes to the client — only the safe job summary", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    serviceMocks.requestExport.mockResolvedValue({
      ...BASE_JOB,
      generatedFile: Buffer.from("pdf-bytes"),
    });

    const result = await requestExportAction({ format: "PDF", scope: "FULL_COMPANY" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data as Record<string, unknown>).generatedFile).toBeUndefined();
      expect(result.data.id).toBe(JOB_ID);
    }
  });

  it("rejects a malformed request (unknown extra field) before the service layer ever runs", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);

    const result = await requestExportAction({
      format: "PDF",
      scope: "FULL_COMPANY",
      notAField: true,
    });

    expect(result.ok).toBe(false);
    expect(serviceMocks.requestExport).not.toHaveBeenCalled();
  });

  it("rejects an unsupported format value before the service layer ever runs", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);

    const result = await requestExportAction({ format: "SVG", scope: "FULL_COMPANY" });

    expect(result.ok).toBe(false);
    expect(serviceMocks.requestExport).not.toHaveBeenCalled();
  });

  it("derives companyId/userId only from the authenticated session, never from client input", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    serviceMocks.requestExport.mockResolvedValue(BASE_JOB);

    await requestExportAction({
      format: "PDF",
      scope: "FULL_COMPANY",
      companyId: "attacker-company",
    });

    expect(serviceMocks.requestExport).not.toHaveBeenCalled();
  });
});

describe("downloadExportFileAction", () => {
  it("returns base64-encoded bytes and content type for a completed job", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    serviceMocks.downloadExportFile.mockResolvedValue({
      filename: "organogram.pdf",
      buffer: Buffer.from("hello"),
      contentType: "application/pdf",
    });

    const result = await downloadExportFileAction({ jobId: JOB_ID });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.base64).toBe(Buffer.from("hello").toString("base64"));
      expect(result.data.contentType).toBe("application/pdf");
    }
  });

  it("re-checks authorization/company scope on every call via the service layer, never trusting a cached job id", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    serviceMocks.downloadExportFile.mockImplementation(() => {
      throw new Error("ExportJob not found: " + JOB_ID);
    });

    const result = await downloadExportFileAction({ jobId: JOB_ID });

    expect(result.ok).toBe(false);
    expect(serviceMocks.downloadExportFile).toHaveBeenCalledWith(JOB_ID, "company-trusted");
  });
});
