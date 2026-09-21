import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

import { NAV_ITEMS } from "@/config/navigation";
import { MobileNav } from "./mobile-nav";

describe("MobileNav", () => {
  it("hides navigation until the trigger is activated", () => {
    render(<MobileNav items={NAV_ITEMS} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open navigation menu/i })).toBeInTheDocument();
  });

  it("opens an accessible dialog containing the nav links on activation", async () => {
    const user = userEvent.setup();
    render(<MobileNav items={NAV_ITEMS} />);

    await user.click(screen.getByRole("button", { name: /open navigation menu/i }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Departments" })).toBeInTheDocument();
  });

  it("closes when a nav link inside it is activated", async () => {
    const user = userEvent.setup();
    render(<MobileNav items={NAV_ITEMS} />);

    await user.click(screen.getByRole("button", { name: /open navigation menu/i }));
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("link", { name: "Departments" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is keyboard-operable: Escape closes the menu", async () => {
    const user = userEvent.setup();
    render(<MobileNav items={NAV_ITEMS} />);

    await user.click(screen.getByRole("button", { name: /open navigation menu/i }));
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
