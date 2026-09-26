import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JobGrade } from "@prisma/client";

vi.mock("@/app/(app)/settings/actions", () => ({
  getCompanyLevelsAction: vi.fn(),
  provisionStandardLevelsAction: vi.fn(),
  addLevelAction: vi.fn(),
  deleteLevelAction: vi.fn(),
  removeUnusedLevelsAction: vi.fn(),
}));

import { LevelsManager } from "./levels-manager";
import {
  addLevelAction,
  deleteLevelAction,
  getCompanyLevelsAction,
  provisionStandardLevelsAction,
  removeUnusedLevelsAction,
} from "@/app/(app)/settings/actions";

function grade(id: string, code: string, displayOrder: number): JobGrade {
  return {
    id,
    companyId: "c1",
    departmentId: null,
    name: code === "L7" ? "Lead / Principal" : code,
    code,
    description: null,
    displayOrder,
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const L7 = grade("g-l7", "L7", 7);
const L9 = grade("g-l9", "L9", 9);

const REFETCH_EMPTY = {
  ok: true as const,
  data: { jobGrades: [L7], levelUsageByCode: { L7: { positionCount: 0, titleCount: 2 } } },
};

function renderManager(overrides: Partial<Parameters<typeof LevelsManager>[0]> = {}) {
  return render(
    <LevelsManager
      initialJobGrades={[L7, L9]}
      initialLevelUsageByCode={{ L7: { positionCount: 0, titleCount: 2 } }}
      {...overrides}
    />
  );
}

describe("LevelsManager", () => {
  it("lists levels with usage, marks an unused one, and only enables removal when unused", () => {
    renderManager();
    // Used level: count shown, remove disabled.
    expect(screen.getByRole("button", { name: /remove level l7/i })).toBeDisabled();
    expect(screen.getByText(/2 titles/i)).toBeInTheDocument();
    // Unused level: badge + enabled remove.
    expect(screen.getByText("Unused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove level l9/i })).toBeEnabled();
  });

  it("removes a single unused level by code", async () => {
    const user = userEvent.setup();
    vi.mocked(deleteLevelAction).mockResolvedValue({ ok: true, data: { deletedCount: 1 } });
    vi.mocked(getCompanyLevelsAction).mockResolvedValue(REFETCH_EMPTY);
    renderManager();

    await user.click(screen.getByRole("button", { name: /remove level l9/i }));
    expect(deleteLevelAction).toHaveBeenCalledWith({ code: "L9" });
  });

  it("offers 'Remove N unused levels' and calls the bulk action", async () => {
    const user = userEvent.setup();
    vi.mocked(removeUnusedLevelsAction).mockResolvedValue({
      ok: true,
      data: { removedCodes: ["L9"] },
    });
    vi.mocked(getCompanyLevelsAction).mockResolvedValue(REFETCH_EMPTY);
    renderManager();

    await user.click(screen.getByRole("button", { name: /remove 1 unused level/i }));
    expect(removeUnusedLevelsAction).toHaveBeenCalledTimes(1);
  });

  it("adds a standard level from the 'Add a level' picker", async () => {
    const user = userEvent.setup();
    vi.mocked(addLevelAction).mockResolvedValue({ ok: true, data: { code: "L10" } });
    vi.mocked(getCompanyLevelsAction).mockResolvedValue(REFETCH_EMPTY);
    // Only L7 present, so L2..L18 minus L7 are addable (incl. L10).
    renderManager({
      initialJobGrades: [L7],
      initialLevelUsageByCode: { L7: { positionCount: 0, titleCount: 2 } },
    });

    await user.selectOptions(screen.getByLabelText(/add a level/i), "L10");
    expect(addLevelAction).toHaveBeenCalledWith({ code: "L10" });
  });

  it("offers 'Set up standard levels' when there are no levels yet", async () => {
    const user = userEvent.setup();
    vi.mocked(provisionStandardLevelsAction).mockResolvedValue({ ok: true, data: { created: 17 } });
    vi.mocked(getCompanyLevelsAction).mockResolvedValue(REFETCH_EMPTY);
    renderManager({ initialJobGrades: [], initialLevelUsageByCode: {} });

    expect(screen.getByText(/no levels set up yet/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /set up standard levels/i }));
    expect(provisionStandardLevelsAction).toHaveBeenCalledTimes(1);
  });
});
