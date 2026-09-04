import { describe, expect, it } from "vitest";

import { PERMISSIONS, permissionsForRole, roleHasPermission } from "./permissions";

describe("permissionsForRole", () => {
  it("grants ADMIN every defined permission", () => {
    const granted = permissionsForRole("ADMIN");
    for (const permission of PERMISSIONS) {
      expect(granted).toContain(permission);
    }
  });

  it("grants HR_EDITOR management permissions but not users:manage or settings:manage", () => {
    const granted = permissionsForRole("HR_EDITOR");
    expect(granted).toContain("departments:manage");
    expect(granted).toContain("positions:manage");
    expect(granted).toContain("employees:manage");
    expect(granted).not.toContain("users:manage");
    expect(granted).not.toContain("settings:manage");
  });

  it("grants VIEWER only *:view permissions", () => {
    const granted = permissionsForRole("VIEWER");
    for (const permission of granted) {
      expect(permission.endsWith(":view")).toBe(true);
    }
    expect(granted).not.toContain("departments:manage");
    expect(granted).not.toContain("imports:execute");
  });

  it("returns no permissions for a missing role", () => {
    expect(permissionsForRole(null)).toEqual([]);
    expect(permissionsForRole(undefined)).toEqual([]);
  });

  it("returns no permissions for an unknown role string (deny-by-default)", () => {
    expect(permissionsForRole("SUPER_ADMIN")).toEqual([]);
    expect(permissionsForRole("")).toEqual([]);
  });
});

describe("roleHasPermission", () => {
  it("returns true for a granted permission", () => {
    expect(roleHasPermission("ADMIN", "users:manage")).toBe(true);
  });

  it("returns false for a permission the role doesn't have", () => {
    expect(roleHasPermission("VIEWER", "departments:manage")).toBe(false);
  });

  it("returns false for an unknown role", () => {
    expect(roleHasPermission("NOT_A_ROLE", "dashboard:view")).toBe(false);
  });
});
