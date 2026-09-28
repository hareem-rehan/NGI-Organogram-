import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Position } from "@prisma/client";

const { getSubtreeSizeActionMock, changeReportsToActionMock } = vi.hoisted(() => ({
  getSubtreeSizeActionMock: vi.fn(),
  changeReportsToActionMock: vi.fn(),
}));

vi.mock("@/app/(app)/positions/actions", () => ({
  getSubtreeSizeAction: getSubtreeSizeActionMock,
  changeReportsToAction: changeReportsToActionMock,
}));

// The shared Combobox's Radix Popover hangs in jsdom once opened (see
// position-move-dialog.test.tsx); stand it in with a native <select> so the
// dialog's own second-head logic can be driven. The real popover is covered
// by e2e/positions.spec.ts.
vi.mock("@/components/ui/combobox", () => ({
  Combobox: (props: {
    id?: string;
    value: string | null;
    onChange: (value: string) => void;
    options: readonly { value: string; label: string }[];
    "aria-label"?: string;
  }) => (
    <select
      id={props.id}
      aria-label={props["aria-label"]}
      value={props.value ?? ""}
      onChange={(event) => props.onChange(event.target.value)}
    >
      {props.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

import { PositionMoveDialog } from "./position-move-dialog";

const ROOT_ID = "11111111-1111-4111-8111-111111111111";
const HEAD_A_ID = "22222222-2222-4222-8222-222222222222";
const HEAD_B_ID = "33333333-3333-4333-8333-333333333333";
const TARGET_ID = "44444444-4444-4444-8444-444444444444";

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: ROOT_ID,
    companyId: "company-1",
    departmentId: "dept-1",
    jobGradeId: null,
    jobFamilyId: null,
    careerTrackId: null,
    title: "CEO",
    positionCode: "POS-CEO",
    ladderKind: null,
    description: null,
    location: null,
    status: "ACTIVE",
    primaryReportsToPositionId: null,
    coReportsToPositionId: null,
    organizationalLevel: 1,
    displayOrder: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const root = makePosition();
const headA = makePosition({
  id: HEAD_A_ID,
  title: "Sr. Software Engineer II",
  positionCode: "POS-A",
  primaryReportsToPositionId: ROOT_ID,
  organizationalLevel: 2,
});
const headB = makePosition({
  id: HEAD_B_ID,
  title: "Associate Tech Lead",
  positionCode: "POS-B",
  primaryReportsToPositionId: ROOT_ID,
  organizationalLevel: 2,
});

function renderDialog(target: Position, onOpenChange = vi.fn()) {
  render(
    <PositionMoveDialog
      open
      onOpenChange={onOpenChange}
      position={target}
      allPositions={[root, headA, headB, target]}
      onMoved={() => {}}
    />
  );
  return { onOpenChange };
}

const secondHeadPicker = () =>
  screen.getByRole("combobox", { name: /second reports-to position/i });

describe("PositionMoveDialog — second head (D27)", () => {
  beforeEach(() => {
    getSubtreeSizeActionMock.mockResolvedValue({ ok: true, data: 0 });
    changeReportsToActionMock.mockResolvedValue({ ok: true, data: root });
  });
  afterEach(() => vi.clearAllMocks());

  it("prefills the second head and never offers the position itself or its first head", async () => {
    const target = makePosition({
      id: TARGET_ID,
      title: "Sr. Software Engineer",
      primaryReportsToPositionId: HEAD_A_ID,
      coReportsToPositionId: HEAD_B_ID,
      organizationalLevel: 3,
    });
    renderDialog(target);

    await waitFor(() => expect(secondHeadPicker()).toHaveDisplayValue("Associate Tech Lead"));
    const labels = within(secondHeadPicker())
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(labels).not.toContain("Sr. Software Engineer"); // itself
    expect(labels).not.toContain("Sr. Software Engineer II"); // its first head
  });

  it("saves a new second head together with the unchanged first head", async () => {
    const user = userEvent.setup();
    const target = makePosition({
      id: TARGET_ID,
      title: "Sr. Software Engineer",
      primaryReportsToPositionId: HEAD_A_ID,
      organizationalLevel: 3,
    });
    const { onOpenChange } = renderDialog(target);

    expect(screen.getByRole("button", { name: /confirm move/i })).toBeDisabled();
    await user.selectOptions(secondHeadPicker(), HEAD_B_ID);
    await user.click(screen.getByRole("button", { name: /confirm move/i }));

    await waitFor(() =>
      expect(changeReportsToActionMock).toHaveBeenCalledWith({
        positionId: TARGET_ID,
        newParentPositionId: HEAD_A_ID,
        coReportsToPositionId: HEAD_B_ID,
      })
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("removes the second head when 'None' is chosen", async () => {
    const user = userEvent.setup();
    const target = makePosition({
      id: TARGET_ID,
      primaryReportsToPositionId: HEAD_A_ID,
      coReportsToPositionId: HEAD_B_ID,
      organizationalLevel: 3,
    });
    renderDialog(target);
    await waitFor(() => expect(secondHeadPicker()).toHaveValue(HEAD_B_ID));

    await user.selectOptions(secondHeadPicker(), "");
    await user.click(screen.getByRole("button", { name: /confirm move/i }));

    await waitFor(() =>
      expect(changeReportsToActionMock).toHaveBeenCalledWith(
        expect.objectContaining({ coReportsToPositionId: null })
      )
    );
  });

  it("hides the second-head picker and sends none when 'make root' is chosen", async () => {
    const user = userEvent.setup();
    const target = makePosition({
      id: TARGET_ID,
      primaryReportsToPositionId: HEAD_A_ID,
      coReportsToPositionId: HEAD_B_ID,
      organizationalLevel: 3,
    });
    renderDialog(target);

    await user.selectOptions(
      screen.getByRole("combobox", { name: /new reports-to position/i }),
      "__root__"
    );
    expect(
      screen.queryByRole("combobox", { name: /second reports-to position/i })
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /confirm move/i }));

    await waitFor(() =>
      expect(changeReportsToActionMock).toHaveBeenCalledWith({
        positionId: TARGET_ID,
        newParentPositionId: null,
        coReportsToPositionId: null,
      })
    );
  });

  it("shows the server's refusal and stays open", async () => {
    changeReportsToActionMock.mockResolvedValue({
      ok: false,
      error: "This change would create a reporting cycle.",
    });
    const user = userEvent.setup();
    const target = makePosition({
      id: TARGET_ID,
      primaryReportsToPositionId: HEAD_A_ID,
      organizationalLevel: 3,
    });
    const { onOpenChange } = renderDialog(target);

    await user.selectOptions(secondHeadPicker(), HEAD_B_ID);
    await user.click(screen.getByRole("button", { name: /confirm move/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/reporting cycle/i);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
