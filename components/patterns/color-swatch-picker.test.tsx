import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fireEvent } from "@testing-library/react";

import { ColorSwatchPicker, DEPARTMENT_COLOR_PRESETS } from "./color-swatch-picker";

describe("ColorSwatchPicker", () => {
  it("selecting a preset reports that exact color", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ColorSwatchPicker id="color" value={null} onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: new RegExp(DEPARTMENT_COLOR_PRESETS[0]) }));
    expect(onChange).toHaveBeenCalledWith(DEPARTMENT_COLOR_PRESETS[0]);
  });

  it("offers a full-spectrum picker that reports the chosen hex", () => {
    const onChange = vi.fn();
    render(<ColorSwatchPicker id="color" value={null} onChange={onChange} />);

    const picker = screen.getByLabelText(/pick a custom color/i) as HTMLInputElement;
    expect(picker.type).toBe("color");
    fireEvent.input(picker, { target: { value: "#123abc" } });
    expect(onChange).toHaveBeenCalledWith("#123abc");
  });

  it("shows a custom (non-preset) color as selected on the picker swatch", () => {
    render(<ColorSwatchPicker id="color" value="#123abc" onChange={() => {}} />);
    // A non-preset value drives the picker to that value, not black.
    const picker = screen.getByLabelText(/pick a custom color/i) as HTMLInputElement;
    expect(picker.value).toBe("#123abc");
  });

  it("typing a partial hex does not crash the native picker (falls back to black)", () => {
    render(<ColorSwatchPicker id="color" value="#12" onChange={() => {}} />);
    const picker = screen.getByLabelText(/pick a custom color/i) as HTMLInputElement;
    expect(picker.value).toBe("#000000");
  });
});
