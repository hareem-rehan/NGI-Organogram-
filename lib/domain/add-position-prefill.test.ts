import { describe, expect, it } from "vitest";

import { addPositionPrefill, type PrefillCard, type PrefillPosition } from "./add-position-prefill";

// CEO (Founder) → CDS: CCO → Associate Director → Product (sub-department):
// Product Manager → Analyst. Plus a QA sub-division under the Associate Director.
const positions: PrefillPosition[] = [
  {
    id: "ceo",
    departmentId: "founder",
    primaryReportsToPositionId: null,
    organizationalLevel: 1,
    title: "CEO",
  },
  {
    id: "cco",
    departmentId: "cds",
    primaryReportsToPositionId: "ceo",
    organizationalLevel: 2,
    title: "CCO",
  },
  {
    id: "ad",
    departmentId: "cds",
    primaryReportsToPositionId: "cco",
    organizationalLevel: 3,
    title: "Associate Director",
  },
  {
    id: "pm",
    departmentId: "product",
    primaryReportsToPositionId: "ad",
    organizationalLevel: 4,
    title: "Product Manager",
  },
  {
    id: "pa",
    departmentId: "product",
    primaryReportsToPositionId: "pm",
    organizationalLevel: 5,
    title: "Analyst",
  },
];

const cards: PrefillCard[] = [
  {
    positionId: "ceo",
    departmentId: "founder",
    jobFamilyId: null,
    primaryReportsToPositionId: null,
  },
  {
    positionId: "dept:cds",
    kind: "department",
    departmentId: "cds",
    jobFamilyId: null,
    primaryReportsToPositionId: "ceo",
  },
  {
    positionId: "cco",
    departmentId: "cds",
    jobFamilyId: null,
    primaryReportsToPositionId: "dept:cds",
  },
  {
    positionId: "ad",
    departmentId: "cds",
    jobFamilyId: "fam-lead",
    primaryReportsToPositionId: "cco",
  },
  {
    positionId: "dept:product",
    kind: "department",
    departmentId: "product",
    jobFamilyId: null,
    primaryReportsToPositionId: "dept:cds",
  },
  {
    positionId: "subdiv:ad:qa",
    kind: "subdivision",
    departmentId: "cds",
    jobFamilyId: "qa",
    primaryReportsToPositionId: "ad",
  },
  {
    positionId: "dept:empty",
    kind: "department",
    departmentId: "empty",
    jobFamilyId: null,
    primaryReportsToPositionId: "dept:cds",
  },
];
const card = (id: string) => cards.find((c) => c.positionId === id)!;

describe("addPositionPrefill", () => {
  it("+ on a position card: its department and sub-division, reporting to it", () => {
    expect(addPositionPrefill(card("ad"), cards, positions)).toEqual({
      departmentId: "cds",
      reportsToPositionId: "ad",
      jobFamilyId: "fam-lead",
    });
  });

  it("+ on a sub-division box: its department and sub-division, reporting to the position above", () => {
    expect(addPositionPrefill(card("subdiv:ad:qa"), cards, positions)).toEqual({
      departmentId: "cds",
      reportsToPositionId: "ad",
      jobFamilyId: "qa",
    });
  });

  it("+ on a top-level department box: reports to the manager of its most senior position", () => {
    expect(addPositionPrefill(card("dept:cds"), cards, positions)).toEqual({
      departmentId: "cds",
      reportsToPositionId: "ceo",
      jobFamilyId: null,
    });
  });

  it("+ on a sub-department box: reports to the position its head reports to, not the CEO", () => {
    expect(addPositionPrefill(card("dept:product"), cards, positions)).toEqual({
      departmentId: "product",
      reportsToPositionId: "ad",
      jobFamilyId: null,
    });
  });

  it("+ on an empty department box: the nearest position above it on the chart", () => {
    expect(addPositionPrefill(card("dept:empty"), cards, positions).reportsToPositionId).toBe(
      "ceo"
    );
  });

  it("the CEO's own department: reports to the CEO (no one above)", () => {
    const founderBox: PrefillCard = {
      positionId: "dept:founder",
      kind: "department",
      departmentId: "founder",
      jobFamilyId: null,
      primaryReportsToPositionId: null,
    };
    expect(addPositionPrefill(founderBox, cards, positions).reportsToPositionId).toBe("ceo");
  });
});
