import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const {
  listImportJobsActionMock,
  downloadImportTemplateActionMock,
  uploadImportActionMock,
  validateImportActionMock,
} = vi.hoisted(() => ({
  listImportJobsActionMock: vi.fn(),
  downloadImportTemplateActionMock: vi.fn(),
  uploadImportActionMock: vi.fn(),
  validateImportActionMock: vi.fn(),
}));

vi.mock("@/app/(app)/imports/actions", () => ({
  listImportJobsAction: listImportJobsActionMock,
  downloadImportTemplateAction: downloadImportTemplateActionMock,
  uploadImportAction: uploadImportActionMock,
  validateImportAction: validateImportActionMock,
  getImportRowIssuesAction: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  confirmImportAction: vi.fn(),
  executeImportAction: vi.fn(),
  cancelImportAction: vi.fn(),
  downloadImportErrorReportAction: vi.fn(),
}));

import { ImportView } from "./import-view";

describe("ImportView", () => {
  afterEach(() => vi.clearAllMocks());

  it("shows a loading state, then an empty state when there are no recent imports", async () => {
    listImportJobsActionMock.mockResolvedValue({ ok: true, data: [] });
    render(<ImportView />);

    expect(screen.getByRole("status")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("No imports yet.")).toBeInTheDocument());
  });

  it("lists recent import jobs with their status", async () => {
    listImportJobsActionMock.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "job-1",
          importType: "DEPARTMENT",
          importMode: "UPSERT",
          status: "COMPLETED",
          totalRows: 3,
          createCount: 2,
          updateCount: 1,
          unchangedCount: 0,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
    });
    render(<ImportView />);

    await waitFor(() => expect(screen.getByText("COMPLETED")).toBeInTheDocument());
    expect(screen.getByText("2 created, 1 updated")).toBeInTheDocument();
  });

  it('the "Download template" button triggers the template action for the selected import type', async () => {
    const user = userEvent.setup();
    listImportJobsActionMock.mockResolvedValue({ ok: true, data: [] });
    downloadImportTemplateActionMock.mockResolvedValue({
      ok: true,
      data: {
        filename: "department-import-template.csv",
        content: "departmentCode,departmentName\n",
      },
    });

    // jsdom does not implement URL.createObjectURL/revokeObjectURL —
    // stubbed here purely so the download side-effect doesn't throw;
    // this test verifies the action is called with the right type, not
    // the browser's own download mechanics.
    URL.createObjectURL = vi.fn().mockReturnValue("blob:mock");
    URL.revokeObjectURL = vi.fn();

    render(<ImportView />);
    await waitFor(() => expect(screen.getByText("No imports yet.")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /download template/i }));

    await waitFor(() =>
      expect(downloadImportTemplateActionMock).toHaveBeenCalledWith({ importType: "DEPARTMENT" })
    );
  });

  it("switching the import type changes which template is requested", async () => {
    const user = userEvent.setup();
    listImportJobsActionMock.mockResolvedValue({ ok: true, data: [] });
    downloadImportTemplateActionMock.mockResolvedValue({
      ok: true,
      data: { filename: "position-import-template.csv", content: "positionCode\n" },
    });
    URL.createObjectURL = vi.fn().mockReturnValue("blob:mock");
    URL.revokeObjectURL = vi.fn();

    render(<ImportView />);
    await waitFor(() => expect(screen.getByText("No imports yet.")).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText("Import type"), "POSITION");
    await user.click(screen.getByRole("button", { name: /download template/i }));

    await waitFor(() =>
      expect(downloadImportTemplateActionMock).toHaveBeenCalledWith({ importType: "POSITION" })
    );
  });

  it("disables the mode selector and shows a hint for ASSIGNMENT imports (operation-based, not create/update mode)", async () => {
    const user = userEvent.setup();
    listImportJobsActionMock.mockResolvedValue({ ok: true, data: [] });
    render(<ImportView />);
    await waitFor(() => expect(screen.getByText("No imports yet.")).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText("Import type"), "ASSIGNMENT");

    expect(screen.getByLabelText("Mode")).toBeDisabled();
    expect(screen.getByText(/operation column/i)).toBeInTheDocument();
  });
});
