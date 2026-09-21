/**
 * Named *.integration.test.ts (and runs under vitest.integration.config.mts)
 * purely so its "react-server" resolve condition lets this file import
 * dashboard.service.ts at all — that file (like every lib/services/*.ts)
 * is guarded by `import "server-only"`, which throws unconditionally
 * under the standard unit config on purpose (lib/env.server-boundary.test.ts
 * proves the guard itself works there). This file otherwise mocks the
 * entire repository layer — it never touches the real Postgres test
 * database — so it is not a "real DB" integration test; it specifically
 * exercises getDashboardSummary's partial-section-failure isolation
 * (docs/DASHBOARD_METRICS.md §J), which is legitimately unit-testable
 * with mocks per docs/TEST_STRATEGY.md §15 ("isolating a component from
 * network calls it doesn't need").
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const repoMocks = vi.hoisted(() => ({
  findCompanyByIdMock: vi.fn(),
  getDepartmentCountsMock: vi.fn(),
  getPositionCountsMock: vi.fn(),
  countOccupiedActivePositionsMock: vi.fn(),
  getEmployeeCountsMock: vi.fn(),
  countActiveAssignedEmployeesMock: vi.fn(),
  getAssignmentCountsMock: vi.fn(),
  countEligibleActivePositionsMock: vi.fn(),
  countOccupiedEligibleActivePositionsMock: vi.fn(),
  getPositionHierarchySnapshotMock: vi.fn(),
  findRootPositionRowMock: vi.fn(),
  findPositionsWithMultipleEffectiveOccupantsMock: vi.fn(),
  findEmployeesWithMultipleEffectiveAssignmentsMock: vi.fn(),
  buildDepartmentSummariesMock: vi.fn(),
  findActivePositionsInInactiveDepartmentsMock: vi.fn(),
  findAssignmentsWithInactiveEmployeeMock: vi.fn(),
  findAssignmentsWithInactivePositionMock: vi.fn(),
}));

vi.mock("@/lib/repositories/company.repository", () => ({
  findCompanyById: repoMocks.findCompanyByIdMock,
}));
vi.mock("@/lib/repositories/dashboard.repository", () => ({
  getDepartmentCounts: repoMocks.getDepartmentCountsMock,
  getPositionCounts: repoMocks.getPositionCountsMock,
  countOccupiedActivePositions: repoMocks.countOccupiedActivePositionsMock,
  getEmployeeCounts: repoMocks.getEmployeeCountsMock,
  countActiveAssignedEmployees: repoMocks.countActiveAssignedEmployeesMock,
  getAssignmentCounts: repoMocks.getAssignmentCountsMock,
  countEligibleActivePositions: repoMocks.countEligibleActivePositionsMock,
  countOccupiedEligibleActivePositions: repoMocks.countOccupiedEligibleActivePositionsMock,
  getPositionHierarchySnapshot: repoMocks.getPositionHierarchySnapshotMock,
  findRootPositionRow: repoMocks.findRootPositionRowMock,
  findPositionsWithMultipleEffectiveOccupants:
    repoMocks.findPositionsWithMultipleEffectiveOccupantsMock,
  findEmployeesWithMultipleEffectiveAssignments:
    repoMocks.findEmployeesWithMultipleEffectiveAssignmentsMock,
  buildDepartmentSummaries: repoMocks.buildDepartmentSummariesMock,
  findActivePositionsInInactiveDepartments: repoMocks.findActivePositionsInInactiveDepartmentsMock,
  findAssignmentsWithInactiveEmployee: repoMocks.findAssignmentsWithInactiveEmployeeMock,
  findAssignmentsWithInactivePosition: repoMocks.findAssignmentsWithInactivePositionMock,
}));

import { getDashboardSummary } from "./dashboard.service";

function mockHappyDefaults() {
  repoMocks.findCompanyByIdMock.mockResolvedValue({
    id: "company-1",
    name: "Acme",
    code: "ACME",
    timezone: "UTC",
  });
  repoMocks.getDepartmentCountsMock.mockResolvedValue({
    totalActive: 0,
    totalInactive: 0,
    topLevelActive: 0,
    nestedActive: 0,
  });
  repoMocks.getPositionCountsMock.mockResolvedValue({ totalActive: 0, planned: 0, inactive: 0 });
  repoMocks.countOccupiedActivePositionsMock.mockResolvedValue(0);
  repoMocks.getEmployeeCountsMock.mockResolvedValue({ active: 0, inactiveOrTerminated: 0 });
  repoMocks.countActiveAssignedEmployeesMock.mockResolvedValue(0);
  repoMocks.getAssignmentCountsMock.mockResolvedValue({ currentPrimary: 0, future: 0 });
  repoMocks.countEligibleActivePositionsMock.mockResolvedValue(0);
  repoMocks.countOccupiedEligibleActivePositionsMock.mockResolvedValue(0);
  repoMocks.getPositionHierarchySnapshotMock.mockResolvedValue([]);
  repoMocks.findRootPositionRowMock.mockResolvedValue(null);
  repoMocks.findPositionsWithMultipleEffectiveOccupantsMock.mockResolvedValue([]);
  repoMocks.findEmployeesWithMultipleEffectiveAssignmentsMock.mockResolvedValue([]);
  repoMocks.buildDepartmentSummariesMock.mockResolvedValue([]);
  repoMocks.findActivePositionsInInactiveDepartmentsMock.mockResolvedValue([]);
  repoMocks.findAssignmentsWithInactiveEmployeeMock.mockResolvedValue([]);
  repoMocks.findAssignmentsWithInactivePositionMock.mockResolvedValue([]);
}

describe("getDashboardSummary — partial-section-failure isolation", () => {
  afterEach(() => vi.clearAllMocks());

  it("still returns every other section's real data when buildDepartmentSummaries throws", async () => {
    mockHappyDefaults();
    repoMocks.getPositionCountsMock.mockResolvedValue({ totalActive: 5, planned: 0, inactive: 0 });
    repoMocks.buildDepartmentSummariesMock.mockRejectedValue(new Error("connection reset"));

    const summary = await getDashboardSummary({
      companyId: "company-1",
      canSeeManagementDetails: true,
    });

    expect(summary.sectionErrors.departmentSummaries).toBe(true);
    expect(summary.departmentSummaries).toBeNull();
    expect(summary.positions.totalActive).toBe(5);
    expect(summary.sectionErrors.warnings).toBe(false);
  });

  it("still returns every other section's real data when the warnings section throws", async () => {
    mockHappyDefaults();
    repoMocks.getEmployeeCountsMock.mockResolvedValue({ active: 7, inactiveOrTerminated: 0 });
    repoMocks.findActivePositionsInInactiveDepartmentsMock.mockRejectedValue(new Error("timeout"));

    const summary = await getDashboardSummary({
      companyId: "company-1",
      canSeeManagementDetails: true,
    });

    expect(summary.sectionErrors.warnings).toBe(true);
    expect(summary.warnings).toBeNull();
    expect(summary.employees.active).toBe(7);
    expect(summary.sectionErrors.departmentSummaries).toBe(false);
  });

  it("never attempts the warnings section at all for a caller without management details (never even a section error)", async () => {
    mockHappyDefaults();

    const summary = await getDashboardSummary({
      companyId: "company-1",
      canSeeManagementDetails: false,
    });

    expect(repoMocks.findActivePositionsInInactiveDepartmentsMock).not.toHaveBeenCalled();
    expect(summary.warnings).toBeNull();
    expect(summary.sectionErrors.warnings).toBe(false);
  });

  it("reports no section errors at all on a fully healthy request", async () => {
    mockHappyDefaults();

    const summary = await getDashboardSummary({
      companyId: "company-1",
      canSeeManagementDetails: true,
    });

    expect(summary.sectionErrors).toEqual({ departmentSummaries: false, warnings: false });
  });
});
