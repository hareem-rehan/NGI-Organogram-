import { afterEach, describe, expect, it, vi } from "vitest";

// jsdom's `File`/`Blob` polyfill (this project's default test
// environment) implements neither `arrayBuffer()` nor `text()` — a real
// gap in jsdom itself, not something this app's code can work around,
// since Server Actions always run in a real Node runtime (where `File`
// natively supports both) and genuinely need `arrayBuffer()` to read an
// uploaded file's bytes. Polyfilled here, once, for this test file only,
// by reading jsdom's own internal Buffer off the wrapped implementation
// object (the only place the bytes actually live in this jsdom version).
if (typeof File !== "undefined" && typeof File.prototype.arrayBuffer !== "function") {
  File.prototype.arrayBuffer = function (this: Blob) {
    const implSymbol = Object.getOwnPropertySymbols(this).find((s) => s.description === "impl");
    const impl = implSymbol
      ? (this as unknown as Record<symbol, { _buffer?: Buffer }>)[implSymbol]
      : undefined;
    const buffer = impl?._buffer ?? Buffer.alloc(0);
    const copy = new Uint8Array(buffer.byteLength);
    copy.set(buffer);
    return Promise.resolve(copy.buffer);
  };
}

const { requirePermissionMock, serviceMocks } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  serviceMocks: {
    uploadImportFile: vi.fn(),
    validateImportJob: vi.fn(),
    confirmImportJob: vi.fn(),
    executeImportJob: vi.fn(),
    cancelImportJob: vi.fn(),
    getImportJob: vi.fn(),
    listImportJobs: vi.fn(),
    getImportRowIssues: vi.fn(),
  },
}));

vi.mock("@/lib/auth/current-user", () => ({ requirePermission: requirePermissionMock }));
vi.mock("@/lib/services/import.service", () => serviceMocks);

import { ForbiddenError, UnauthenticatedError } from "@/lib/auth/errors";
import {
  cancelImportAction,
  confirmImportAction,
  downloadImportErrorReportAction,
  downloadImportTemplateAction,
  executeImportAction,
  getImportJobAction,
  getImportRowIssuesAction,
  listImportJobsAction,
  uploadImportAction,
  validateImportAction,
} from "./actions";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_USER = { id: "u_1", role: "ADMIN", companyId: "company-trusted", status: "ACTIVE" };

function makeUploadFormData(
  overrides: Partial<{ file: File; importType: string; importMode: string }> = {}
) {
  const formData = new FormData();
  formData.set(
    "file",
    overrides.file ??
      new File(["departmentCode,departmentName\nENG,Engineering\n"], "import.csv", {
        type: "text/csv",
      })
  );
  formData.set("importType", overrides.importType ?? "DEPARTMENT");
  formData.set("importMode", overrides.importMode ?? "UPSERT");
  return formData;
}

describe("import actions — server-side authorization", () => {
  afterEach(() => vi.clearAllMocks());

  it.each([
    ["uploadImportAction", () => uploadImportAction(makeUploadFormData())],
    ["validateImportAction", () => validateImportAction({ jobId: JOB_ID })],
    [
      "confirmImportAction",
      () => confirmImportAction({ jobId: JOB_ID, acknowledgeWarnings: false }),
    ],
    ["executeImportAction", () => executeImportAction({ jobId: JOB_ID })],
    ["cancelImportAction", () => cancelImportAction({ jobId: JOB_ID })],
    ["getImportJobAction", () => getImportJobAction({ jobId: JOB_ID })],
    ["listImportJobsAction", () => listImportJobsAction()],
    ["getImportRowIssuesAction", () => getImportRowIssuesAction({ jobId: JOB_ID })],
    [
      "downloadImportTemplateAction",
      () => downloadImportTemplateAction({ importType: "DEPARTMENT" }),
    ],
    ["downloadImportErrorReportAction", () => downloadImportErrorReportAction({ jobId: JOB_ID })],
  ])("%s requires imports:execute", async (_name, invoke) => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    Object.values(serviceMocks).forEach((mock) => mock.mockResolvedValue([]));
    serviceMocks.getImportRowIssues.mockResolvedValue([]);

    await invoke();

    expect(requirePermissionMock).toHaveBeenCalledWith("imports:execute");
  });

  it("a VIEWER-role rejection (ForbiddenError) blocks upload before the service layer ever runs", async () => {
    requirePermissionMock.mockRejectedValue(new ForbiddenError());

    const result = await uploadImportAction(makeUploadFormData());

    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to do that.",
      authRedirect: "/access-denied",
    });
    expect(serviceMocks.uploadImportFile).not.toHaveBeenCalled();
  });

  it("an unauthenticated caller is blocked before the service layer ever runs", async () => {
    requirePermissionMock.mockRejectedValue(new UnauthenticatedError());

    const result = await listImportJobsAction();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.authRedirect).toBe("/sign-in");
    expect(serviceMocks.listImportJobs).not.toHaveBeenCalled();
  });

  it("companyId always comes from the authenticated session, never from the input payload", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    serviceMocks.uploadImportFile.mockResolvedValue({});

    const formData = makeUploadFormData();
    formData.set("companyId", "attacker-company");
    await uploadImportAction(formData);

    expect(serviceMocks.uploadImportFile).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: ADMIN_USER.companyId, userId: ADMIN_USER.id })
    );
  });

  it("rejects an upload with no file at all", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    const formData = new FormData();
    formData.set("importType", "DEPARTMENT");
    formData.set("importMode", "UPSERT");

    const result = await uploadImportAction(formData);

    expect(result.ok).toBe(false);
    expect(serviceMocks.uploadImportFile).not.toHaveBeenCalled();
  });

  it("rejects a non-.csv filename before ever reading its content", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    const formData = makeUploadFormData({
      file: new File(["binary-ish content"], "definitely-not-csv.exe", {
        type: "application/octet-stream",
      }),
    });

    const result = await uploadImportAction(formData);

    expect(result.ok).toBe(false);
    expect(serviceMocks.uploadImportFile).not.toHaveBeenCalled();
  });

  it("rejects an invalid importType before calling the service", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);
    const formData = makeUploadFormData({ importType: "NOT_A_REAL_TYPE" });

    const result = await uploadImportAction(formData);

    expect(result.ok).toBe(false);
    expect(serviceMocks.uploadImportFile).not.toHaveBeenCalled();
  });

  it("downloadImportTemplateAction returns a real template without touching any service function requiring a company lookup", async () => {
    requirePermissionMock.mockResolvedValue(ADMIN_USER);

    const result = await downloadImportTemplateAction({ importType: "POSITION" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.filename).toContain("position");
      expect(result.data.content).toContain("positionCode");
    }
  });
});
