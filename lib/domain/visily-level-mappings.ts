/**
 * The company's department structure, colours, career-ladder configuration,
 * and Level-Mapping titles, taken from the stakeholder's Visily org chart and
 * the checkin.nextgeni.com Level Mapping tool (transcribed 2026-09-28).
 *
 * Shared by `prisma/seed.ts` (demo company) and the one-off staging config
 * script so the two never drift. Career progression only — nothing here sets a
 * reporting relationship (docs/DECISIONS.md).
 */

import type { CareerTrackKind } from "@prisma/client";

export interface VisilyDepartment {
  code: string;
  name: string;
  /** Card/legend colour (hex). */
  color: string;
  /** Parent department code, or null for a top-level department. */
  parentCode: string | null;
  hasIcLadder: boolean;
  hasManagerLadder: boolean;
}

/**
 * Departments in create order (parents before children). The nested model
 * agreed with the stakeholder: Client Delivery Services → Project + Product;
 * Delivery Org / Administration → IT. Departments with no career ladders
 * (both false) are excluded from the Level Mapping grid.
 */
export const VISILY_DEPARTMENTS: readonly VisilyDepartment[] = [
  {
    code: "FOUNDER",
    name: "Founder",
    color: "#6d28d9",
    parentCode: null,
    hasIcLadder: false,
    hasManagerLadder: false,
  },
  {
    code: "ENGINEERING",
    name: "Engineering",
    color: "#4fae2f",
    parentCode: null,
    hasIcLadder: true,
    hasManagerLadder: true,
  },
  {
    code: "HR",
    name: "Human Resources",
    color: "#d9a400",
    parentCode: null,
    hasIcLadder: false,
    hasManagerLadder: true,
  },
  {
    code: "FINANCE",
    name: "Finance",
    color: "#9b7fe0",
    parentCode: null,
    hasIcLadder: false,
    hasManagerLadder: false,
  },
  {
    code: "MARKETING",
    name: "Marketing",
    color: "#e8811a",
    parentCode: null,
    hasIcLadder: false,
    hasManagerLadder: false,
  },
  {
    code: "CLIENT-DELIVERY",
    name: "Client Delivery Services",
    color: "#3aa4e8",
    parentCode: null,
    hasIcLadder: false,
    hasManagerLadder: false,
  },
  {
    code: "DELIVERY-ADMIN",
    name: "Delivery Org / Administration",
    color: "#ec6fa8",
    parentCode: null,
    hasIcLadder: false,
    hasManagerLadder: false,
  },
  {
    code: "PROJECT",
    name: "Project",
    color: "#2563eb",
    parentCode: "CLIENT-DELIVERY",
    hasIcLadder: false,
    hasManagerLadder: true,
  },
  {
    code: "PRODUCT",
    name: "Product",
    color: "#7c3aed",
    parentCode: "CLIENT-DELIVERY",
    hasIcLadder: true,
    hasManagerLadder: true,
  },
  {
    code: "IT",
    name: "IT",
    color: "#00b8d4",
    parentCode: "DELIVERY-ADMIN",
    hasIcLadder: false,
    hasManagerLadder: true,
  },
];

export interface VisilyLevelTitle {
  jobGradeCode: string;
  title: string;
}

/**
 * Level Mapping titles per department code → ladder kind → [{ level, title }],
 * transcribed exactly from checkin.nextgeni.com/level-mappings.
 */
export const VISILY_LEVEL_TITLES: Record<
  string,
  Partial<Record<CareerTrackKind, readonly VisilyLevelTitle[]>>
> = {
  ENGINEERING: {
    IC: [
      { jobGradeCode: "L2", title: "Trainee / Associate" },
      { jobGradeCode: "L3", title: "Software Engineer" },
      { jobGradeCode: "L4", title: "Software Engineer II" },
      { jobGradeCode: "L5", title: "Senior Software/QA/DevOps Engineer" },
      { jobGradeCode: "L6", title: "Senior Software/QA/DevOps/* Engineer II" },
      { jobGradeCode: "L7", title: "Principal Software Engineer" },
      { jobGradeCode: "L8", title: "Principal Software Engineer II" },
      { jobGradeCode: "L9", title: "Associate Architect" },
      { jobGradeCode: "L10", title: "Architect" },
      { jobGradeCode: "L11", title: "Solution Architect" },
      { jobGradeCode: "L12", title: "Senior Solution Architect" },
    ],
    MANAGER: [
      { jobGradeCode: "L6", title: "Associate Tech Lead" },
      { jobGradeCode: "L7", title: "Tech Lead" },
      { jobGradeCode: "L8", title: "Senior Tech Lead" },
      { jobGradeCode: "L9", title: "Associate Manager" },
      { jobGradeCode: "L10", title: "Manager" },
      { jobGradeCode: "L11", title: "Associate Director" },
      { jobGradeCode: "L12", title: "Director" },
      { jobGradeCode: "L13", title: "Senior Director" },
      { jobGradeCode: "L14", title: "Associate VP" },
      { jobGradeCode: "L15", title: "VP" },
      { jobGradeCode: "L16", title: "Senior VP" },
      { jobGradeCode: "L17", title: "Senior Executive VP" },
      { jobGradeCode: "L18", title: "C*" },
    ],
  },
  PROJECT: {
    MANAGER: [
      { jobGradeCode: "L4", title: "PC" },
      { jobGradeCode: "L5", title: "APM 1" },
      { jobGradeCode: "L6", title: "APM II" },
      { jobGradeCode: "L7", title: "Project Manager / Technical Project Manager" },
      { jobGradeCode: "L8", title: "Senior Project Manager" },
      { jobGradeCode: "L9", title: "Associate Delivery Manager" },
      { jobGradeCode: "L10", title: "Delivery Manager" },
      { jobGradeCode: "L11", title: "Associate Director" },
      { jobGradeCode: "L12", title: "Director" },
      { jobGradeCode: "L13", title: "Senior Director" },
      { jobGradeCode: "L14", title: "Associate VP" },
      { jobGradeCode: "L15", title: "VP" },
      { jobGradeCode: "L16", title: "Senior VP" },
      { jobGradeCode: "L17", title: "Senior Executive VP" },
      { jobGradeCode: "L18", title: "C*" },
    ],
  },
  PRODUCT: {
    IC: [
      { jobGradeCode: "L2", title: "Trainee / Associate" },
      { jobGradeCode: "L3", title: "Product/Business Analyst" },
      { jobGradeCode: "L4", title: "Product/Business Analyst 2" },
      { jobGradeCode: "L5", title: "Senior Product/Business Analyst" },
    ],
    MANAGER: [
      { jobGradeCode: "L6", title: "Associate Product Manager" },
      { jobGradeCode: "L7", title: "Product Manager / Technical Product Manager" },
      { jobGradeCode: "L8", title: "Senior Product Manager" },
      { jobGradeCode: "L9", title: "Associate Group Product Manager" },
      { jobGradeCode: "L10", title: "Group Product Manager" },
      { jobGradeCode: "L11", title: "Associate Director" },
      { jobGradeCode: "L12", title: "Director" },
      { jobGradeCode: "L13", title: "Senior Director" },
      { jobGradeCode: "L14", title: "Associate VP" },
      { jobGradeCode: "L15", title: "VP" },
      { jobGradeCode: "L16", title: "Senior VP" },
      { jobGradeCode: "L17", title: "Senior Executive VP" },
      { jobGradeCode: "L18", title: "C*" },
    ],
  },
  HR: {
    MANAGER: [
      { jobGradeCode: "L2", title: "Trainee HR Executive" },
      { jobGradeCode: "L3", title: "Jr. HR Executive" },
      { jobGradeCode: "L4", title: "HR Executive" },
      { jobGradeCode: "L5", title: "Sr. HR Executive" },
      { jobGradeCode: "L6", title: "Associate HR Manager" },
      { jobGradeCode: "L7", title: "HR Manager" },
      { jobGradeCode: "L8", title: "Sr. HR Manager" },
      { jobGradeCode: "L9", title: "Associate Head of HR" },
      { jobGradeCode: "L10", title: "Head of HR" },
      { jobGradeCode: "L11", title: "Associate Director" },
      { jobGradeCode: "L12", title: "Director" },
      { jobGradeCode: "L13", title: "Senior Director" },
      { jobGradeCode: "L14", title: "Associate VP" },
      { jobGradeCode: "L15", title: "VP" },
      { jobGradeCode: "L16", title: "Senior VP" },
      { jobGradeCode: "L17", title: "Senior Executive VP" },
      { jobGradeCode: "L18", title: "C*" },
    ],
  },
  IT: {
    MANAGER: [
      { jobGradeCode: "L2", title: "Trainee IT Officer" },
      { jobGradeCode: "L4", title: "IT Officer" },
      { jobGradeCode: "L5", title: "Sr. IT Officer" },
      { jobGradeCode: "L6", title: "Associate IT Manager" },
      { jobGradeCode: "L7", title: "IT Manager" },
      { jobGradeCode: "L8", title: "IT Sr. Manager" },
      { jobGradeCode: "L9", title: "Associate Head of IT Ops." },
      { jobGradeCode: "L10", title: "Head of IT Ops." },
    ],
  },
};
