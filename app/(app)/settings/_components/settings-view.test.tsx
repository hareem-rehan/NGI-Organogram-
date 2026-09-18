import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { getSettingsActionMock, updateCompanyProfileActionMock, updateSettingsActionMock } =
  vi.hoisted(() => ({
    getSettingsActionMock: vi.fn(),
    updateCompanyProfileActionMock: vi.fn(),
    updateSettingsActionMock: vi.fn(),
  }));

vi.mock("@/app/(app)/settings/actions", () => ({
  getSettingsAction: getSettingsActionMock,
  updateCompanyProfileAction: updateCompanyProfileActionMock,
  updateSettingsAction: updateSettingsActionMock,
}));

import { SettingsView } from "./settings-view";

const SAMPLE_PAYLOAD = {
  company: {
    id: "c1",
    name: "Northwind",
    legalName: null,
    code: "NW",
    timezone: "UTC",
    status: "ACTIVE" as const,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  },
  settings: {
    id: "s1",
    companyId: "c1",
    brandingText: null,
    defaultExpansionDepth: 2,
    defaultViewMode: "visual",
    showPlannedByDefault: true,
    defaultPdfPageSize: "A3",
    defaultPdfLayoutMode: "AUTO",
    defaultPngScale: 2,
    includeLegendByDefault: true,
    includeConfidentialityLabelByDefault: true,
    exportRetentionDays: 7,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  },
  auth: {
    providerName: "Company Account",
    allowedDomains: ["northwind-example.test"],
    autoProvisionViewersEnabled: false,
  },
};

describe("SettingsView", () => {
  it("renders the company profile, organogram/export defaults, and read-only auth info", async () => {
    getSettingsActionMock.mockResolvedValue({ ok: true, data: SAMPLE_PAYLOAD });
    render(<SettingsView />);
    await waitFor(() => expect(screen.getByDisplayValue("Northwind")).toBeInTheDocument());
    expect(screen.getByText(/company code: nw/i)).toBeInTheDocument();
    expect(screen.getByText("Company Account")).toBeInTheDocument();
    expect(screen.getByText("northwind-example.test")).toBeInTheDocument();
  });

  it("saves the company profile and shows a saved confirmation", async () => {
    getSettingsActionMock.mockResolvedValue({ ok: true, data: SAMPLE_PAYLOAD });
    updateCompanyProfileActionMock.mockResolvedValue({ ok: true, data: SAMPLE_PAYLOAD.company });
    const user = userEvent.setup();
    render(<SettingsView />);
    await waitFor(() => expect(screen.getByDisplayValue("Northwind")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() => expect(updateCompanyProfileActionMock).toHaveBeenCalled());
    expect(screen.getAllByText(/saved\./i).length).toBeGreaterThan(0);
  });

  it("surfaces a stale-update error without crashing", async () => {
    getSettingsActionMock.mockResolvedValue({ ok: true, data: SAMPLE_PAYLOAD });
    updateSettingsActionMock.mockResolvedValue({
      ok: false,
      error: "This record was changed by someone else. Reload and try again.",
    });
    const user = userEvent.setup();
    render(<SettingsView />);
    await waitFor(() => expect(screen.getByDisplayValue("Northwind")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /save organogram defaults/i }));
    await waitFor(() => expect(screen.getByText(/changed by someone else/i)).toBeInTheDocument());
  });

  it("never renders an editable field for the SSO client secret or any token", async () => {
    getSettingsActionMock.mockResolvedValue({ ok: true, data: SAMPLE_PAYLOAD });
    render(<SettingsView />);
    await waitFor(() => expect(screen.getByDisplayValue("Northwind")).toBeInTheDocument());
    expect(screen.queryByText(/client secret/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/access token/i)).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/secret/i);
  });
});
