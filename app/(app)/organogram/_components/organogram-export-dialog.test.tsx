import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { requestExportActionMock, downloadExportFileActionMock } = vi.hoisted(() => ({
  requestExportActionMock: vi.fn(),
  downloadExportFileActionMock: vi.fn(),
}));

vi.mock("@/app/(app)/organogram/export-actions", () => ({
  requestExportAction: requestExportActionMock,
  downloadExportFileAction: downloadExportFileActionMock,
}));

import { OrganogramExportDialog } from "./organogram-export-dialog";
import type { OrganogramNode } from "@/lib/domain/organogram";
import { emptyFilterState } from "@/lib/domain/organogram-filters";

function makeNode(overrides: Partial<OrganogramNode> & { positionId: string }): OrganogramNode {
  return {
    positionCode: `POS-${overrides.positionId}`,
    title: `Title ${overrides.positionId}`,
    departmentId: "dept-1",
    departmentName: "Engineering",
    departmentCode: "ENG",
    departmentColor: "#16a34a",
    jobGradeId: null,
    jobGradeName: null,
    organizationalLevel: 1,
    positionStatus: "ACTIVE",
    occupancyStatus: "vacant",
    occupantDisplayName: null,
    occupantEmployeeId: null,
    directReportCount: 0,
    primaryReportsToPositionId: null,
    hasChildren: false,
    isPlanned: false,
    isActive: true,
    ...overrides,
  };
}

const NODES: OrganogramNode[] = [makeNode({ positionId: "root", title: "CEO" })];
const DEPARTMENTS = [{ id: "dept-1", name: "Engineering" }];

const FULL_COMPANY_CONTEXT = {
  view: "full" as const,
  positionId: null,
  departmentId: null,
  depth: 2 as const,
  filters: emptyFilterState(),
  showPlanned: true,
};

const COMPLETED_JOB = {
  id: "job-1",
  companyId: "c1",
  requestedByUserId: "u1",
  format: "PDF" as const,
  scope: "FULL_COMPANY" as const,
  optionsSnapshot: {},
  scopeLabel: "Full Company",
  nodeCount: 1,
  status: "COMPLETED" as const,
  generatedFilename: "organogram.pdf",
  fileSize: 100,
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

describe("OrganogramExportDialog", () => {
  it("defaults scope to Full Company when the interactive chart is in the full view", () => {
    render(
      <OrganogramExportDialog
        open={true}
        onOpenChange={vi.fn()}
        nodes={NODES}
        departmentEntries={DEPARTMENTS}
        currentContext={FULL_COMPANY_CONTEXT}
      />
    );
    expect(screen.getByRole("combobox", { name: /scope/i })).toHaveValue("FULL_COMPANY");
  });

  it("defaults scope to Current View when opened while the chart is in Position Focus", () => {
    render(
      <OrganogramExportDialog
        open={true}
        onOpenChange={vi.fn()}
        nodes={NODES}
        departmentEntries={DEPARTMENTS}
        currentContext={{ ...FULL_COMPANY_CONTEXT, view: "position", positionId: "root" }}
      />
    );
    expect(screen.getByRole("combobox", { name: /scope/i })).toHaveValue("CURRENT_VIEW");
  });

  it("disables Generate export until a position is chosen for Position Focus scope", async () => {
    const user = userEvent.setup();
    render(
      <OrganogramExportDialog
        open={true}
        onOpenChange={vi.fn()}
        nodes={NODES}
        departmentEntries={DEPARTMENTS}
        currentContext={FULL_COMPANY_CONTEXT}
      />
    );
    await user.selectOptions(screen.getByRole("combobox", { name: /scope/i }), "POSITION_FOCUS");
    expect(screen.getByRole("button", { name: /generate export/i })).toBeDisabled();

    await user.selectOptions(screen.getByRole("combobox", { name: /position/i }), "root");
    expect(screen.getByRole("button", { name: /generate export/i })).toBeEnabled();
  });

  it("requests an export and shows a Download button on success", async () => {
    const user = userEvent.setup();
    requestExportActionMock.mockResolvedValue({ ok: true, data: COMPLETED_JOB });
    render(
      <OrganogramExportDialog
        open={true}
        onOpenChange={vi.fn()}
        nodes={NODES}
        departmentEntries={DEPARTMENTS}
        currentContext={FULL_COMPANY_CONTEXT}
      />
    );

    await user.click(screen.getByRole("button", { name: /generate export/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /download organogram\.pdf/i })).toBeInTheDocument();
    });
    expect(requestExportActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ format: "PDF", scope: "FULL_COMPANY" })
    );
  });

  it("shows a clear error message when the export request fails, never a raw error", async () => {
    const user = userEvent.setup();
    requestExportActionMock.mockResolvedValue({
      ok: false,
      error: "The export could not be generated.",
    });
    render(
      <OrganogramExportDialog
        open={true}
        onOpenChange={vi.fn()}
        nodes={NODES}
        departmentEntries={DEPARTMENTS}
        currentContext={FULL_COMPANY_CONTEXT}
      />
    );

    await user.click(screen.getByRole("button", { name: /generate export/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("The export could not be generated.");
    });
  });

  it("downloads the generated file via a base64-decoded blob when Download is clicked", async () => {
    const user = userEvent.setup();
    requestExportActionMock.mockResolvedValue({ ok: true, data: COMPLETED_JOB });
    downloadExportFileActionMock.mockResolvedValue({
      ok: true,
      data: { filename: "organogram.pdf", contentType: "application/pdf", base64: btoa("hello") },
    });

    const createObjectURL = vi.fn().mockReturnValue("blob:mock-url");
    const revokeObjectURL = vi.fn();
    // jsdom implements neither — a real gap in jsdom, not this code's responsibility.
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    render(
      <OrganogramExportDialog
        open={true}
        onOpenChange={vi.fn()}
        nodes={NODES}
        departmentEntries={DEPARTMENTS}
        currentContext={FULL_COMPANY_CONTEXT}
      />
    );
    await user.click(screen.getByRole("button", { name: /generate export/i }));
    await waitFor(() => screen.getByRole("button", { name: /download organogram\.pdf/i }));

    await user.click(screen.getByRole("button", { name: /download organogram\.pdf/i }));

    await waitFor(() => {
      expect(downloadExportFileActionMock).toHaveBeenCalledWith({ jobId: "job-1" });
    });
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("warns (without blocking) when PNG is selected for a chart large enough to exceed the safe render limit (Phase 13.1, DEF-010)", async () => {
    const user = userEvent.setup();
    // 100 nodes: exceeds the safe estimate at 2x scale (250/4=62) but not
    // at 1x scale (250) — chosen to exercise both the "warns" and "warning
    // clears once you pick a smaller scale" behaviors in one test.
    const manyNodes: OrganogramNode[] = Array.from({ length: 100 }, (_, i) =>
      makeNode({ positionId: `p${i}`, title: `Position ${i}` })
    );
    render(
      <OrganogramExportDialog
        open={true}
        onOpenChange={vi.fn()}
        nodes={manyNodes}
        departmentEntries={DEPARTMENTS}
        currentContext={FULL_COMPANY_CONTEXT}
      />
    );

    // PDF (the default format) shows no PNG-specific warning at all.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: /format/i }), "PNG");
    expect(screen.getByRole("alert")).toHaveTextContent(/pdf/i);
    // A warning is guidance only — it never disables the button; the
    // server is the real, authoritative enforcement point.
    expect(screen.getByRole("button", { name: /generate export/i })).toBeEnabled();

    // Selecting a low enough scale removes the warning at this node count.
    await user.selectOptions(screen.getByRole("combobox", { name: /image scale/i }), "1");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("resets to the form when the dialog is reopened", () => {
    const { rerender } = render(
      <OrganogramExportDialog
        open={false}
        onOpenChange={vi.fn()}
        nodes={NODES}
        departmentEntries={DEPARTMENTS}
        currentContext={FULL_COMPANY_CONTEXT}
      />
    );
    rerender(
      <OrganogramExportDialog
        open={true}
        onOpenChange={vi.fn()}
        nodes={NODES}
        departmentEntries={DEPARTMENTS}
        currentContext={FULL_COMPANY_CONTEXT}
      />
    );
    expect(screen.getByRole("button", { name: /generate export/i })).toBeInTheDocument();
  });
});
