import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXPORT_COLORS, resolveDepartmentColor } from "./colors";

/**
 * `colors.ts` is a hand-maintained copy of `app/globals.css`'s design
 * tokens, because neither export renderer can resolve CSS custom
 * properties. "Keep in sync by hand" failed exactly as you'd expect: the
 * DotZero rebrand updated `globals.css` alone, and every export kept
 * rendering in the pre-rebrand blue/slate palette until a user noticed
 * it in a downloaded PNG. This test reads the real stylesheet and
 * compares, so the next rebrand fails CI instead of shipping.
 */
function readCssToken(css: string, token: string): string | null {
  const match = new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{3,8})`).exec(css);
  return match?.[1]?.toLowerCase() ?? null;
}

describe("EXPORT_COLORS", () => {
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf-8");

  it.each([
    ["background", "color-background"],
    ["foreground", "color-foreground"],
    ["muted", "color-muted"],
    ["mutedForeground", "color-muted-foreground"],
    ["border", "color-border"],
    ["primary", "color-primary"],
    ["statusFilled", "color-status-filled"],
    ["statusVacant", "color-status-vacant"],
    ["statusPlanned", "color-status-planned"],
    ["statusInactive", "color-status-inactive"],
  ])("%s matches the --%s token in app/globals.css", (exportKey, cssToken) => {
    const cssValue = readCssToken(css, cssToken);
    expect(cssValue, `--${cssToken} not found in app/globals.css`).not.toBeNull();
    expect(EXPORT_COLORS[exportKey as keyof typeof EXPORT_COLORS].toLowerCase()).toBe(cssValue);
  });
});

describe("resolveDepartmentColor", () => {
  it("returns the department's own color when it has one", () => {
    expect(resolveDepartmentColor("#123456")).toBe("#123456");
  });

  it("falls back to the neutral border token when the department has no color", () => {
    expect(resolveDepartmentColor(null)).toBe(EXPORT_COLORS.border);
  });
});
