import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { listMock, createMock, revokeMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  revokeMock: vi.fn(),
}));
vi.mock("@/app/(app)/organogram/share-actions", () => ({
  listShareLinksAction: listMock,
  createShareLinkAction: createMock,
  revokeShareLinkAction: revokeMock,
}));

import { ShareLinksDialog } from "./share-links-dialog";

const TOKEN = "k".repeat(43);
const ACTIVE = {
  id: "11111111-1111-4111-8111-111111111111",
  token: TOKEN,
  label: "Board pack",
  createdAt: new Date("2026-10-19"),
  expiresAt: new Date("2026-11-18"),
  revokedAt: null,
  status: "active" as const,
};

afterEach(() => vi.clearAllMocks());

describe("ShareLinksDialog (D60)", () => {
  it("creates a link with the chosen label and expiry, then shows it to copy", async () => {
    listMock
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValue({ ok: true, data: [ACTIVE] });
    createMock.mockResolvedValue({ ok: true, data: ACTIVE });
    const user = userEvent.setup();
    render(<ShareLinksDialog open onOpenChange={() => {}} />);

    expect(await screen.findByText(/no links yet/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/label/i), "Board pack");
    await user.selectOptions(screen.getByLabelText(/link works for/i), "never");
    await user.click(screen.getByRole("button", { name: /create link/i }));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({ label: "Board pack", expiresInDays: null })
    );
    const link = await screen.findByRole("textbox", { name: /link for board pack/i });
    expect((link as HTMLInputElement).value).toBe(`${window.location.origin}/share/${TOKEN}`);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("turning a link off asks to confirm first", async () => {
    listMock.mockResolvedValue({ ok: true, data: [ACTIVE] });
    revokeMock.mockResolvedValue({ ok: true, data: { ...ACTIVE, status: "off" } });
    const user = userEvent.setup();
    render(<ShareLinksDialog open onOpenChange={() => {}} />);

    await user.click(await screen.findByRole("button", { name: /^turn off$/i }));
    expect(revokeMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /turn off for everyone/i }));

    await waitFor(() => expect(revokeMock).toHaveBeenCalledWith({ shareLinkId: ACTIVE.id }));
  });

  it("an expired or turned-off link offers no copy or turn-off controls", async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [{ ...ACTIVE, status: "off", revokedAt: new Date("2026-10-20") }],
    });
    render(<ShareLinksDialog open onOpenChange={() => {}} />);

    expect(await screen.findByText("Turned off")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /link for/i })).toBeNull();
  });
});
