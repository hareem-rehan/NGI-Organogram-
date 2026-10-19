import { afterEach, describe, expect, it, vi } from "vitest";

const { serviceMocks } = vi.hoisted(() => ({
  serviceMocks: { getSharedChartData: vi.fn(), exportSharedChart: vi.fn() },
}));
vi.mock("@/lib/services/share-link.service", () => serviceMocks);

import { exportSharedOrganogramAction, getSharedOrganogramAction } from "./actions";

const TOKEN = "a".repeat(43);

afterEach(() => vi.clearAllMocks());

describe("view-only link actions (D60) — the token is the only credential", () => {
  it("passes a well-formed token to the service", async () => {
    serviceMocks.getSharedChartData.mockResolvedValue({ nodes: [] });
    const result = await getSharedOrganogramAction({ token: TOKEN });
    expect(result.ok).toBe(true);
    expect(serviceMocks.getSharedChartData).toHaveBeenCalledWith(TOKEN);
  });

  it("rejects a malformed token (or extra fields) before touching the service", async () => {
    for (const input of [
      { token: "short" },
      { token: `${TOKEN}!` },
      { token: TOKEN, companyId: "x" },
      {},
    ]) {
      expect((await getSharedOrganogramAction(input)).ok).toBe(false);
      expect(
        (
          await exportSharedOrganogramAction({
            ...input,
            options: { format: "PDF", scope: "FULL_COMPANY" },
          })
        ).ok
      ).toBe(false);
    }
    expect(serviceMocks.getSharedChartData).not.toHaveBeenCalled();
    expect(serviceMocks.exportSharedChart).not.toHaveBeenCalled();
  });

  it("returns an export as a downloadable file", async () => {
    serviceMocks.exportSharedChart.mockResolvedValue({
      buffer: Buffer.from("PDF!"),
      filename: "organogram.pdf",
      contentType: "application/pdf",
      format: "PDF",
      pageCount: 1,
      nodeCount: 3,
    });
    const result = await exportSharedOrganogramAction({
      token: TOKEN,
      options: { format: "PDF", scope: "FULL_COMPANY" },
    });
    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        filename: "organogram.pdf",
        base64: Buffer.from("PDF!").toString("base64"),
        fileSize: 4,
      }),
    });
  });
});
