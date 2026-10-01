import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TextStylePanel } from "./text-style-panel";

function renderPanel(overrides: Partial<Parameters<typeof TextStylePanel>[0]> = {}) {
  const props = {
    open: true,
    targetLabel: "All cards",
    isChart: true,
    saved: {},
    inherited: {},
    onPreview: vi.fn(),
    onSave: vi.fn().mockResolvedValue(null),
    onReset: vi.fn().mockResolvedValue(null),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<TextStylePanel {...props} />);
  return props;
}

describe("TextStylePanel (D41)", () => {
  it("previews every change live and saves the chosen style", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    await user.selectOptions(screen.getByLabelText("Font"), "georgia");
    await user.selectOptions(screen.getByLabelText(/^size/i), "16");
    await user.selectOptions(screen.getByLabelText("Weight"), "regular");
    await user.click(screen.getByRole("button", { name: "Italic" }));
    await user.click(screen.getByRole("button", { name: "Underline" }));
    expect(props.onPreview).toHaveBeenLastCalledWith({
      fontFamily: "georgia",
      fontSize: 16,
      bold: false,
      italic: true,
      underline: true,
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(props.onSave).toHaveBeenCalledWith({
      fontFamily: "georgia",
      fontSize: 16,
      bold: false,
      italic: true,
      underline: true,
    });
    expect(props.onClose).toHaveBeenCalled();
  });

  it("for one card, turning off a style it inherits stores an explicit 'off'", async () => {
    const user = userEvent.setup();
    const props = renderPanel({ isChart: false, targetLabel: "CTO", inherited: { italic: true } });
    const italic = screen.getByRole("button", { name: "Italic" });
    expect(italic).toHaveAttribute("aria-pressed", "true");
    await user.click(italic);
    expect(props.onPreview).toHaveBeenLastCalledWith({ italic: false });
  });

  it("offers reset only when the target has its own style, and shows a refusal", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue("You don't have permission to do that.");
    const props = renderPanel({ saved: { bold: true }, onSave });
    expect(screen.getByRole("button", { name: "Reset to default" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/permission/);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("has no reset button when nothing is saved", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: /reset|use the style/i })).not.toBeInTheDocument();
  });
});
