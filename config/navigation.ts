import type { Permission } from "@/lib/auth/permissions";

export interface NavItem {
  href: string;
  label: string;
  description: string;
  /** Phase from docs/IMPLEMENTATION_PLAN.md that implements this module. */
  plannedPhase: number;
  /** The permission required to see/use this item — docs/AUTHORIZATION_MATRIX.md. */
  permission: Permission;
}

/**
 * Single source of truth for the application's top-level routes. Desktop
 * nav, mobile nav, and every placeholder page all read from this list so
 * there is exactly one place to add/rename/reorder a section. Navigation
 * visibility is filtered by permission (Phase 3) — this is a UX
 * convenience only; every route additionally re-checks permission
 * server-side (lib/auth/current-user.ts), since hidden navigation is
 * never a substitute for real authorization.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    description: "Company overview and key organizational metrics.",
    plannedPhase: 7,
    permission: "dashboard:view",
  },
  {
    href: "/organogram",
    label: "Organogram",
    description: "Interactive, automatically-generated company hierarchy chart.",
    plannedPhase: 8,
    permission: "organogram:view",
  },
  {
    href: "/departments",
    label: "Departments",
    description: "Manage departments and their structure.",
    plannedPhase: 4,
    permission: "departments:view",
  },
  {
    href: "/positions",
    label: "Positions",
    description: "Manage positions and primary reporting relationships.",
    plannedPhase: 5,
    permission: "positions:view",
  },
  {
    href: "/employees",
    label: "Employees",
    description: "Manage employee records and position assignments.",
    plannedPhase: 6,
    permission: "employees:view",
  },
  {
    href: "/imports",
    label: "Imports",
    description: "Bulk-import organizational data from CSV, with validation and preview.",
    plannedPhase: 10,
    permission: "imports:execute",
  },
  {
    href: "/audit-log",
    label: "Audit Log",
    description: "History of every structural change, with who/when/before/after.",
    plannedPhase: 12,
    permission: "audit:view",
  },
  {
    href: "/users",
    label: "Users",
    description: "Provision Company SSO users, manage roles, and link employees.",
    plannedPhase: 12,
    permission: "users:manage",
  },
  {
    href: "/settings",
    label: "Settings",
    description: "Company profile, organogram and export defaults, and Company SSO status.",
    plannedPhase: 12,
    permission: "settings:manage",
  },
] as const;
