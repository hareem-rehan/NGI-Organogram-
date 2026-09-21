import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  usePathname: () => "/departments",
}));

import { NAV_ITEMS } from "@/config/navigation";
import { NavLinks } from "./nav-links";

describe("NavLinks", () => {
  it("renders every configured route as an accessible link", () => {
    render(<NavLinks />);
    for (const item of NAV_ITEMS) {
      expect(screen.getByRole("link", { name: item.label })).toHaveAttribute("href", item.href);
    }
  });

  it("marks the current route with aria-current=page", () => {
    render(<NavLinks />);
    expect(screen.getByRole("link", { name: "Departments" })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("link", { name: "Positions" })).not.toHaveAttribute("aria-current");
  });

  it("is fully keyboard-reachable (each link is a real focusable anchor)", async () => {
    const [firstItem, secondItem] = NAV_ITEMS;
    if (!firstItem || !secondItem) throw new Error("expected at least two NAV_ITEMS for this test");

    const user = userEvent.setup();
    render(<NavLinks />);
    const first = screen.getByRole("link", { name: firstItem.label });
    first.focus();
    expect(first).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: secondItem.label })).toHaveFocus();
  });

  it("calls onNavigate when a link is activated (used to close the mobile sheet)", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<NavLinks onNavigate={onNavigate} />);
    await user.click(screen.getByRole("link", { name: "Departments" }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});
