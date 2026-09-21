import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { listAuditEventsActionMock, getAuditEventActionMock } = vi.hoisted(() => ({
  listAuditEventsActionMock: vi.fn(),
  getAuditEventActionMock: vi.fn(),
}));

vi.mock("@/app/(app)/audit-log/actions", () => ({
  listAuditEventsAction: listAuditEventsActionMock,
  getAuditEventAction: getAuditEventActionMock,
}));

import { AuditLogView } from "./audit-log-view";

const SAMPLE_EVENT = {
  id: "event-1",
  companyId: "c1",
  actorUserId: "u1",
  actorType: "USER" as const,
  actorDisplayNameSnapshot: "Ada Lovelace",
  actorEmailSnapshot: "ada@northwind-example.test",
  action: "UPDATED" as const,
  category: "DEPARTMENT" as const,
  entityType: "Department",
  entityId: "dept-1",
  entityDisplayReference: "ENG",
  beforeData: { name: "Engineering" },
  afterData: { name: "Engineering Team" },
  changedFields: ["name"],
  correlationId: "corr-1",
  importJobId: null,
  exportJobId: null,
  safeMetadata: null,
  occurredAt: new Date("2026-01-01T10:00:00.000Z"),
  createdAt: new Date("2026-01-01T10:00:00.000Z"),
};

describe("AuditLogView", () => {
  it("shows a loading state, then the event list", async () => {
    listAuditEventsActionMock.mockResolvedValue({
      ok: true,
      data: { events: [SAMPLE_EVENT], total: 1, page: 1, pageSize: 25 },
    });

    render(<AuditLogView />);
    expect(screen.getByText(/loading audit log/i)).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeInTheDocument());
    const table = screen.getByRole("table");
    expect(within(table).getByText("UPDATED")).toBeInTheDocument();
    expect(within(table).getByText("ENG")).toBeInTheDocument();
  });

  it("shows an empty state when there are no matching events", async () => {
    listAuditEventsActionMock.mockResolvedValue({
      ok: true,
      data: { events: [], total: 0, page: 1, pageSize: 25 },
    });
    render(<AuditLogView />);
    await waitFor(() => expect(screen.getByText(/no matching audit events/i)).toBeInTheDocument());
  });

  it("shows an error state with a retry option on failure", async () => {
    listAuditEventsActionMock.mockResolvedValue({ ok: false, error: "Something went wrong." });
    render(<AuditLogView />);
    await waitFor(() => expect(screen.getByText("Something went wrong.")).toBeInTheDocument());
  });

  it("opens the detail dialog with a readable before/after diff and no Edit/Delete controls", async () => {
    listAuditEventsActionMock.mockResolvedValue({
      ok: true,
      data: { events: [SAMPLE_EVENT], total: 1, page: 1, pageSize: 25 },
    });
    getAuditEventActionMock.mockResolvedValue({ ok: true, data: SAMPLE_EVENT });

    const user = userEvent.setup();
    render(<AuditLogView />);
    await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /view details/i }));

    await waitFor(() => expect(screen.getByText("corr-1")).toBeInTheDocument());
    expect(screen.getByText(/"name": "Engineering"/)).toBeInTheDocument();
    expect(screen.getByText(/"name": "Engineering Team"/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete$/i })).not.toBeInTheDocument();
  });
});
