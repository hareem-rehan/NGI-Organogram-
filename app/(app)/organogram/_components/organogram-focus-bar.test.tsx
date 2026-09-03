import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OrganogramFocusBar } from "./organogram-focus-bar";

describe("OrganogramFocusBar", () => {
  it("shows the Position Focus label and depth selector", () => {
    render(
      <OrganogramFocusBar
        view="position"
        focusLabel="VP Engineering"
        depth={2}
        onDepthChange={vi.fn()}
        onReturnToFullView={vi.fn()}
        onCopyLink={vi.fn().mockResolvedValue(true)}
      />
    );
    expect(screen.getByText("Position Focus")).toBeInTheDocument();
    expect(screen.getByText(/VP Engineering/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /descendant depth/i })).toBeInTheDocument();
  });

  it("shows the Department Focus label with no depth selector", () => {
    render(
      <OrganogramFocusBar
        view="department"
        focusLabel="Engineering"
        depth={2}
        onDepthChange={vi.fn()}
        onReturnToFullView={vi.fn()}
        onCopyLink={vi.fn().mockResolvedValue(true)}
      />
    );
    expect(screen.getByText("Department Focus")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /descendant depth/i })).not.toBeInTheDocument();
  });

  it("calls onDepthChange with the selected value", async () => {
    const user = userEvent.setup();
    const onDepthChange = vi.fn();
    render(
      <OrganogramFocusBar
        view="position"
        focusLabel="VP Engineering"
        depth={2}
        onDepthChange={onDepthChange}
        onReturnToFullView={vi.fn()}
        onCopyLink={vi.fn().mockResolvedValue(true)}
      />
    );
    await user.selectOptions(screen.getByRole("combobox", { name: /descendant depth/i }), "all");
    expect(onDepthChange).toHaveBeenCalledWith("all");
  });

  it("calls onReturnToFullView when clicked", async () => {
    const user = userEvent.setup();
    const onReturnToFullView = vi.fn();
    render(
      <OrganogramFocusBar
        view="position"
        focusLabel="VP Engineering"
        depth={2}
        onDepthChange={vi.fn()}
        onReturnToFullView={onReturnToFullView}
        onCopyLink={vi.fn().mockResolvedValue(true)}
      />
    );
    await user.click(screen.getByRole("button", { name: /full company view/i }));
    expect(onReturnToFullView).toHaveBeenCalled();
  });

  it('shows "Copied!" feedback when the copy succeeds', async () => {
    const user = userEvent.setup();
    render(
      <OrganogramFocusBar
        view="position"
        focusLabel="VP Engineering"
        depth={2}
        onDepthChange={vi.fn()}
        onReturnToFullView={vi.fn()}
        onCopyLink={vi.fn().mockResolvedValue(true)}
      />
    );
    await user.click(screen.getByRole("button", { name: /copy view link/i }));
    await waitFor(() => expect(screen.getByText("Copied!")).toBeInTheDocument());
  });

  it('shows "Copy failed" feedback when the clipboard write fails (e.g. permission denied), never a silent no-op', async () => {
    const user = userEvent.setup();
    render(
      <OrganogramFocusBar
        view="position"
        focusLabel="VP Engineering"
        depth={2}
        onDepthChange={vi.fn()}
        onReturnToFullView={vi.fn()}
        onCopyLink={vi.fn().mockResolvedValue(false)}
      />
    );
    await user.click(screen.getByRole("button", { name: /copy view link/i }));
    await waitFor(() => expect(screen.getByText("Copy failed")).toBeInTheDocument());
  });
});
