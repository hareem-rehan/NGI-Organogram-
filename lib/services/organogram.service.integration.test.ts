/**
 * Named *.integration.test.ts (and runs under vitest.integration.config.mts)
 * purely so its "react-server" resolve condition lets this file import
 * organogram.service.ts at all — that file (like every lib/services/*.ts)
 * is guarded by `import "server-only"`, which throws unconditionally
 * under the standard unit config on purpose (see
 * lib/env.server-boundary.test.ts and
 * lib/services/dashboard.service.integration.test.ts, the Phase 7
 * precedent for this exact naming workaround). This file mocks the
 * entire repository layer — it never touches the real Postgres test
 * database.
 */
import { describe, expect, it, vi } from "vitest";

const repoMocks = vi.hoisted(() => ({
  findCompanyByIdMock: vi.fn(),
  getOrganogramRawDataMock: vi.fn(),
}));

vi.mock("@/lib/repositories/company.repository", () => ({
  findCompanyById: repoMocks.findCompanyByIdMock,
}));
vi.mock("@/lib/repositories/organogram.repository", () => ({
  getOrganogramRawData: repoMocks.getOrganogramRawDataMock,
}));

import { getOrganogramData } from "./organogram.service";

function mockCompany() {
  repoMocks.findCompanyByIdMock.mockResolvedValue({
    id: "company-1",
    name: "Acme",
    code: "ACME",
    timezone: "UTC",
  });
}

describe("getOrganogramData", () => {
  it("throws NotFoundError when the company does not exist", async () => {
    repoMocks.findCompanyByIdMock.mockResolvedValue(null);
    await expect(getOrganogramData({ companyId: "missing" })).rejects.toThrow();
  });

  it("assembles nodes/edges from a clean single-root hierarchy", async () => {
    mockCompany();
    repoMocks.getOrganogramRawDataMock.mockResolvedValue({
      positions: [
        {
          id: "root",
          positionCode: "CEO",
          title: "CEO",
          departmentId: "dept-1",
          jobGradeId: null,
          organizationalLevel: 1,
          status: "ACTIVE",
          primaryReportsToPositionId: null,
        },
        {
          id: "child",
          positionCode: "VP",
          title: "VP Eng",
          departmentId: "dept-1",
          jobGradeId: null,
          organizationalLevel: 2,
          status: "ACTIVE",
          primaryReportsToPositionId: "root",
        },
      ],
      departments: [{ id: "dept-1", name: "Engineering", code: "ENG", color: "#16a34a" }],
      jobGradeNamesById: new Map(),
      occupantNamesByPositionId: new Map([["root", "Amara Chen"]]),
      occupantEmployeeIdsByPositionId: new Map([["root", "employee-1"]]),
    });

    const result = await getOrganogramData({ companyId: "company-1", now: new Date("2026-01-01") });

    expect(result.company).toEqual({ name: "Acme", code: "ACME", effectiveDate: "2026-01-01" });
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toEqual([
      { sourcePositionId: "root", targetPositionId: "child", reportingType: "PRIMARY" },
    ]);
    expect(result.safety).toEqual({
      hasRoot: true,
      extraRootCount: 0,
      cyclePositionCount: 0,
      disconnectedPositionCount: 0,
    });
  });

  it("reports safety counts and excludes corrupted positions from nodes/edges, without throwing", async () => {
    mockCompany();
    repoMocks.getOrganogramRawDataMock.mockResolvedValue({
      positions: [
        {
          id: "root",
          positionCode: "CEO",
          title: "CEO",
          departmentId: "dept-1",
          jobGradeId: null,
          organizationalLevel: 1,
          status: "ACTIVE",
          primaryReportsToPositionId: null,
        },
        {
          id: "cycle-a",
          positionCode: "A",
          title: "A",
          departmentId: "dept-1",
          jobGradeId: null,
          organizationalLevel: 2,
          status: "ACTIVE",
          primaryReportsToPositionId: "cycle-b",
        },
        {
          id: "cycle-b",
          positionCode: "B",
          title: "B",
          departmentId: "dept-1",
          jobGradeId: null,
          organizationalLevel: 2,
          status: "ACTIVE",
          primaryReportsToPositionId: "cycle-a",
        },
      ],
      departments: [{ id: "dept-1", name: "Engineering", code: "ENG", color: "#16a34a" }],
      jobGradeNamesById: new Map(),
      occupantNamesByPositionId: new Map(),
      occupantEmployeeIdsByPositionId: new Map(),
    });

    const result = await getOrganogramData({ companyId: "company-1" });

    expect(result.nodes.map((n) => n.positionId)).toEqual(["root"]);
    expect(result.edges).toEqual([]);
    expect(result.safety.cyclePositionCount).toBe(2);
  });

  it("reports hasRoot: false for a company with zero positions", async () => {
    mockCompany();
    repoMocks.getOrganogramRawDataMock.mockResolvedValue({
      positions: [],
      departments: [],
      jobGradeNamesById: new Map(),
      occupantNamesByPositionId: new Map(),
      occupantEmployeeIdsByPositionId: new Map(),
    });

    const result = await getOrganogramData({ companyId: "company-1" });

    expect(result.safety.hasRoot).toBe(false);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });
});
