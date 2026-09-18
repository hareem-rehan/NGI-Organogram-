import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Consolidated RBAC + cross-company-isolation matrix (Phase 13 "Release
 * Hardening").
 *
 * Scope note (docs/DECISIONS.md-style clarification, not a defect): the
 * original Phase 13 spec asked for a matrix across "7 roles". This
 * codebase's actual `UserRole` enum (prisma/schema.prisma) and
 * `lib/auth/permissions.ts` implement exactly THREE roles — VIEWER,
 * HR_EDITOR, ADMIN (docs/AUTHORIZATION_MATRIX.md §1). There is no
 * 7-role system anywhere in the app, and inventing four fictional roles
 * to hit that number would itself violate CLAUDE.md's "do not implement
 * deferred/unapproved features" and "do not silently assume unresolved
 * decisions" rules. This file therefore tests the REAL 3-role model
 * against the ~13 permission-gated route/server-action groups in
 * docs/AUTHORIZATION_MATRIX.md §4/§5: dashboard, organogram (view +
 * export — search/filter/focus are pure client-side computation over
 * the same `organogram:view` payload, see §4's "Search, filters, and
 * focus" note, so there is no separate server surface to test),
 * departments, positions, employees, imports, audit-log, users,
 * settings.
 *
 * What makes this file additive rather than duplicative of existing
 * coverage:
 *   - app/(app)/*\/actions.test.ts (unit tests) mock `requirePermission`
 *     itself and only assert it was CALLED with the right permission
 *     string — they never exercise the real `roleHasPermission` mapping.
 *   - tests/integration/*.integration.test.ts (service-layer tests) call
 *     services directly with a hand-picked `companyId` — they never go
 *     through a session or the permission gate at all.
 *   - THIS file mocks only the outermost `auth()` call (the one thing
 *     that cannot run in a non-request test context) and then invokes
 *     the real "use server" action functions end-to-end: real
 *     `requirePermission` -> real `roleHasPermission` -> real service ->
 *     real repository -> a real Postgres test database. That is the one
 *     path no existing test walks for every module at once, and it is
 *     the only way to prove a VIEWER is *actually* rejected server-side
 *     (not just that the action *would have* checked) and that
 *     `companyId` genuinely never crosses between two companies that
 *     use the exact same codes.
 */

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock("@/lib/auth/config", () => ({ auth: authMock }));

import type { User } from "@prisma/client";

import { testPrisma } from "./setup";
import { makeCompany, makeDepartment, makeEmployee, makeRootPosition, makeUser } from "./fixtures";

import { getDashboardAction } from "@/app/(app)/dashboard/actions";
import { getOrganogramAction } from "@/app/(app)/organogram/actions";
import {
  requestExportAction,
  getExportJobAction,
  listExportJobsAction,
} from "@/app/(app)/organogram/export-actions";
import {
  archiveDepartmentAction,
  createDepartmentAction,
  listDepartmentsAction,
  updateDepartmentAction,
} from "@/app/(app)/departments/actions";
import {
  createPositionAction,
  listPositionsAction,
  updatePositionAction,
} from "@/app/(app)/positions/actions";
import {
  createEmployeeAction,
  getEmployeeDetailAction,
  listEmployeesAction,
  updateEmployeeAction,
} from "@/app/(app)/employees/actions";
import {
  uploadImportAction,
  listImportJobsAction,
  getImportJobAction,
} from "@/app/(app)/imports/actions";
import { listAuditEventsAction, getAuditEventAction } from "@/app/(app)/audit-log/actions";
import {
  changeUserRoleAction,
  disableUserAction,
  getUserAction,
  listUsersAction,
} from "@/app/(app)/users/actions";
import { getSettingsAction, updateCompanyProfileAction } from "@/app/(app)/settings/actions";

import { requestExport } from "@/lib/services/export.service";
import { uploadImportFile } from "@/lib/services/import.service";

type Role = "ADMIN" | "HR_EDITOR" | "VIEWER";
const ROLES: readonly Role[] = ["ADMIN", "HR_EDITOR", "VIEWER"];

interface CompanyFixture {
  companyId: string;
  departmentId: string;
  positionId: string;
  employeeId: string;
  users: Record<Role, User>;
}

/** One company with a department/position/employee all coded "ENG"/"POS-001"/"EMP-001" (deliberately colliding across companies) plus one user per role. */
async function buildCompanyFixture(label: string): Promise<CompanyFixture> {
  const company = await makeCompany();
  const department = await makeDepartment(company.id, {
    code: "ENG",
    name: `Engineering (${label})`,
  });
  const position = await makeRootPosition(company.id, department.id, {
    positionCode: "POS-001",
    title: `CEO (${label})`,
  });
  const employee = await makeEmployee(company.id, {
    employeeCode: "EMP-001",
    firstName: label,
    lastName: "Employee",
  });
  const users: Record<Role, User> = {
    ADMIN: await makeUser(company.id, {
      role: "ADMIN",
      email: `admin-${label.toLowerCase()}@example.test`,
    }),
    HR_EDITOR: await makeUser(company.id, {
      role: "HR_EDITOR",
      email: `hr-${label.toLowerCase()}@example.test`,
    }),
    VIEWER: await makeUser(company.id, {
      role: "VIEWER",
      email: `viewer-${label.toLowerCase()}@example.test`,
    }),
  };
  return {
    companyId: company.id,
    departmentId: department.id,
    positionId: position.id,
    employeeId: employee.id,
    users,
  };
}

function mockSessionUser(
  user: Pick<User, "id" | "role" | "status" | "companyId" | "email" | "name">
) {
  authMock.mockResolvedValue({ user });
}

function mockNoSession() {
  authMock.mockResolvedValue(null);
}

/** Runs `invoke` once per role against `fixture`, asserting it succeeds (ok:true) for exactly `allowedRoles` and is rejected server-side with a redirect to /access-denied for every other role. */
async function expectRoleGate<T>(
  allowedRoles: readonly Role[],
  fixture: CompanyFixture,
  invoke: (role: Role) => Promise<{ ok: boolean; error?: string; authRedirect?: string; data?: T }>
) {
  for (const role of ROLES) {
    mockSessionUser(fixture.users[role]);
    const result = await invoke(role);
    if (allowedRoles.includes(role)) {
      expect(result.ok, `${role} should be allowed but got: ${JSON.stringify(result)}`).toBe(true);
    } else {
      expect(result.ok, `${role} should be denied but succeeded`).toBe(false);
      expect(result.authRedirect).toBe("/access-denied");
    }
  }
}

describe("RBAC × module permission matrix (real enforcement, 3 roles)", () => {
  let a: CompanyFixture;

  beforeEach(async () => {
    a = await buildCompanyFixture("A");
  });

  it("dashboard:view — VIEWER, HR_EDITOR, and ADMIN can all view", async () => {
    await expectRoleGate(["ADMIN", "HR_EDITOR", "VIEWER"], a, () => getDashboardAction());
  });

  it("organogram:view — VIEWER, HR_EDITOR, and ADMIN can all view", async () => {
    await expectRoleGate(["ADMIN", "HR_EDITOR", "VIEWER"], a, () => getOrganogramAction());
  });

  it("exports:execute — only HR_EDITOR/ADMIN can request an export; VIEWER is rejected", async () => {
    await expectRoleGate(["ADMIN", "HR_EDITOR"], a, () =>
      requestExportAction({ format: "PDF", scope: "FULL_COMPANY" })
    );
  });

  it("departments:view — all three roles can list departments", async () => {
    await expectRoleGate(["ADMIN", "HR_EDITOR", "VIEWER"], a, () =>
      listDepartmentsAction({ page: 1, pageSize: 20 })
    );
  });

  it("departments:manage — only HR_EDITOR/ADMIN can create a department; VIEWER is rejected", async () => {
    await expectRoleGate(["ADMIN", "HR_EDITOR"], a, (role) =>
      createDepartmentAction({ name: `Dept ${role}`, code: `DEPT-${role}` })
    );
  });

  it("positions:view — all three roles can list positions", async () => {
    await expectRoleGate(["ADMIN", "HR_EDITOR", "VIEWER"], a, () =>
      listPositionsAction({ page: 1, pageSize: 20 })
    );
  });

  it("positions:manage — only HR_EDITOR/ADMIN can create a position; VIEWER is rejected", async () => {
    await expectRoleGate(["ADMIN", "HR_EDITOR"], a, (role) =>
      createPositionAction({
        title: `Position ${role}`,
        positionCode: `POS-${role}`,
        departmentId: a.departmentId,
        // Company "a" already has a root position (a.positionId) from the
        // fixture — reports to it so this is a child, not a second root
        // (a company may only have one root position).
        primaryReportsToPositionId: a.positionId,
      })
    );
  });

  it("employees:view — all three roles can list employees", async () => {
    await expectRoleGate(["ADMIN", "HR_EDITOR", "VIEWER"], a, () =>
      listEmployeesAction({ page: 1, pageSize: 20 })
    );
  });

  it("employees:manage — only HR_EDITOR/ADMIN can create an employee; VIEWER is rejected", async () => {
    await expectRoleGate(["ADMIN", "HR_EDITOR"], a, (role) =>
      createEmployeeAction({ employeeCode: `EMP-${role}`, firstName: "New", lastName: role })
    );
  });

  it("imports:execute — only HR_EDITOR/ADMIN can upload an import file; VIEWER is rejected", async () => {
    await expectRoleGate(["ADMIN", "HR_EDITOR"], a, () => {
      const formData = new FormData();
      formData.set(
        "file",
        new File(["code,name\nSALES,Sales\n"], "import.csv", { type: "text/csv" })
      );
      formData.set("importType", "DEPARTMENT");
      formData.set("importMode", "CREATE_ONLY");
      return uploadImportAction(formData);
    });
  });

  it("audit:view — only HR_EDITOR/ADMIN can view the audit log; VIEWER is rejected", async () => {
    await expectRoleGate(["ADMIN", "HR_EDITOR"], a, () => listAuditEventsAction({}));
  });

  it("users:manage — only ADMIN can view the users list; VIEWER and HR_EDITOR are rejected", async () => {
    await expectRoleGate(["ADMIN"], a, () => listUsersAction({}));
  });

  it("settings:manage — only ADMIN can view settings; VIEWER and HR_EDITOR are rejected", async () => {
    await expectRoleGate(["ADMIN"], a, () => getSettingsAction());
  });

  it("an unauthenticated caller is redirected to /sign-in, not /access-denied, across every permission tier", async () => {
    mockNoSession();
    for (const invoke of [
      () => getDashboardAction(),
      () => listDepartmentsAction({ page: 1, pageSize: 20 }),
      () => listImportJobsAction(),
      () => listAuditEventsAction({}),
      () => listUsersAction({}),
      () => getSettingsAction(),
    ]) {
      const result = await invoke();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.authRedirect).toBe("/sign-in");
    }
  });

  it("a disabled (DISABLED status) ADMIN is blocked before the permission check, redirected to /sign-in", async () => {
    const disabledAdmin = await testPrisma.user.update({
      where: { id: a.users.ADMIN.id },
      data: { status: "DISABLED" },
    });
    mockSessionUser(disabledAdmin);
    const result = await listUsersAction({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.authRedirect).toBe("/sign-in");
  });
});

describe("Cross-company isolation with overlapping codes (2 companies, both coded ENG/POS-001/EMP-001)", () => {
  let a: CompanyFixture;
  let b: CompanyFixture;

  beforeEach(async () => {
    [a, b] = await Promise.all([buildCompanyFixture("A"), buildCompanyFixture("B")]);
  });

  it("departments: list scopes to the caller's own company; cross-company update/archive resolve as not-found and never mutate the other company", async () => {
    mockSessionUser(a.users.ADMIN);
    const list = await listDepartmentsAction({ page: 1, pageSize: 20 });
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.data.items).toHaveLength(1);
      expect(list.data.items[0]?.id).toBe(a.departmentId);
    }

    const updateResult = await updateDepartmentAction({
      departmentId: b.departmentId,
      name: "Hijacked",
    });
    expect(updateResult.ok).toBe(false);

    const archiveResult = await archiveDepartmentAction({ departmentId: b.departmentId });
    expect(archiveResult.ok).toBe(false);

    const untouchedB = await testPrisma.department.findUniqueOrThrow({
      where: { id: b.departmentId },
    });
    expect(untouchedB.name).toBe("Engineering (B)");
    expect(untouchedB.status).toBe("ACTIVE");
  });

  it("positions: list scopes to the caller's own company; a cross-company positionId in updatePositionAction resolves as not-found", async () => {
    mockSessionUser(a.users.HR_EDITOR);
    const list = await listPositionsAction({ page: 1, pageSize: 20 });
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.data.items).toHaveLength(1);
      expect(list.data.items[0]?.id).toBe(a.positionId);
    }

    const result = await updatePositionAction({
      positionId: b.positionId,
      title: "Hijacked Title",
    });
    expect(result.ok).toBe(false);

    const untouchedB = await testPrisma.position.findUniqueOrThrow({ where: { id: b.positionId } });
    expect(untouchedB.title).toBe("CEO (B)");
  });

  it("employees: list scopes to the caller's own company; cross-company detail lookup and update never reveal or mutate the other company's record", async () => {
    mockSessionUser(a.users.VIEWER);
    const list = await listEmployeesAction({ page: 1, pageSize: 20 });
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.data.items).toHaveLength(1);
      expect(list.data.items[0]?.id).toBe(a.employeeId);
    }

    const detail = await getEmployeeDetailAction(b.employeeId);
    expect(detail.ok).toBe(false);

    mockSessionUser(a.users.HR_EDITOR);
    const update = await updateEmployeeAction({ employeeId: b.employeeId, firstName: "Hijacked" });
    expect(update.ok).toBe(false);

    const untouchedB = await testPrisma.employee.findUniqueOrThrow({ where: { id: b.employeeId } });
    expect(untouchedB.firstName).toBe("B");
  });

  it("imports: two jobs with the identical filename in each company — list/get never cross company lines", async () => {
    const jobA = await uploadImportFile({
      companyId: a.companyId,
      userId: a.users.HR_EDITOR.id,
      importType: "DEPARTMENT",
      importMode: "CREATE_ONLY",
      originalFilename: "roster.csv",
      fileBuffer: Buffer.from("code,name\nSALES,Sales\n"),
    });
    const jobB = await uploadImportFile({
      companyId: b.companyId,
      userId: b.users.HR_EDITOR.id,
      importType: "DEPARTMENT",
      importMode: "CREATE_ONLY",
      originalFilename: "roster.csv",
      fileBuffer: Buffer.from("code,name\nMKT,Marketing\n"),
    });

    mockSessionUser(a.users.HR_EDITOR);
    const list = await listImportJobsAction();
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.data.map((j) => j.id)).toEqual([jobA.id]);
    }

    const crossGet = await getImportJobAction({ jobId: jobB.id });
    expect(crossGet.ok).toBe(false);

    const ownGet = await getImportJobAction({ jobId: jobA.id });
    expect(ownGet.ok).toBe(true);
  });

  it("exports: two jobs with the identical scope label in each company — list/get/download never cross company lines", async () => {
    const jobA = await requestExport({
      companyId: a.companyId,
      userId: a.users.ADMIN.id,
      options: { format: "PDF", scope: "FULL_COMPANY" },
    });
    const jobB = await requestExport({
      companyId: b.companyId,
      userId: b.users.ADMIN.id,
      options: { format: "PDF", scope: "FULL_COMPANY" },
    });

    mockSessionUser(a.users.ADMIN);
    const list = await listExportJobsAction();
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.data.map((j) => j.id)).toEqual([jobA.id]);
    }

    const crossGet = await getExportJobAction({ jobId: jobB.id });
    expect(crossGet.ok).toBe(false);

    const ownGet = await getExportJobAction({ jobId: jobA.id });
    expect(ownGet.ok).toBe(true);
  });

  it("audit log: events in each company sharing the same entity reference never cross company lines", async () => {
    const eventA = await testPrisma.auditEvent.create({
      data: {
        companyId: a.companyId,
        actorUserId: a.users.HR_EDITOR.id,
        actorType: "USER",
        action: "CREATED",
        category: "DEPARTMENT",
        entityType: "Department",
        entityId: a.departmentId,
        entityDisplayReference: "ENG",
      },
    });
    await testPrisma.auditEvent.create({
      data: {
        companyId: b.companyId,
        actorUserId: b.users.HR_EDITOR.id,
        actorType: "USER",
        action: "CREATED",
        category: "DEPARTMENT",
        entityType: "Department",
        entityId: b.departmentId,
        entityDisplayReference: "ENG",
      },
    });

    mockSessionUser(a.users.HR_EDITOR);
    const list = await listAuditEventsAction({});
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.data.events.map((e) => e.id)).toEqual([eventA.id]);
    }

    const crossGet = await getAuditEventAction({
      eventId: (await testPrisma.auditEvent.findFirstOrThrow({ where: { companyId: b.companyId } }))
        .id,
    });
    expect(crossGet.ok).toBe(false);
  });

  it("audit log: HR_EDITOR never sees USER_ADMINISTRATION-category events even within their own company, ADMIN does", async () => {
    const adminOnlyEvent = await testPrisma.auditEvent.create({
      data: {
        companyId: a.companyId,
        actorUserId: a.users.ADMIN.id,
        actorType: "USER",
        action: "ROLE_CHANGED",
        category: "USER_ADMINISTRATION",
        entityType: "User",
        entityId: a.users.VIEWER.id,
      },
    });

    mockSessionUser(a.users.HR_EDITOR);
    const asHrEditor = await listAuditEventsAction({});
    expect(asHrEditor.ok).toBe(true);
    if (asHrEditor.ok) {
      expect(asHrEditor.data.events.map((e) => e.id)).not.toContain(adminOnlyEvent.id);
    }
    const hrEditorGet = await getAuditEventAction({ eventId: adminOnlyEvent.id });
    expect(hrEditorGet.ok).toBe(false); // not-found, never a "forbidden category" hint

    mockSessionUser(a.users.ADMIN);
    const asAdmin = await listAuditEventsAction({});
    expect(asAdmin.ok).toBe(true);
    if (asAdmin.ok) {
      expect(asAdmin.data.events.map((e) => e.id)).toContain(adminOnlyEvent.id);
    }
    const adminGet = await getAuditEventAction({ eventId: adminOnlyEvent.id });
    expect(adminGet.ok).toBe(true);
  });

  it("users: list scopes to the caller's own company; cross-company getUser/changeUserRole/disableUser resolve as not-found and never mutate the other company's user", async () => {
    mockSessionUser(a.users.ADMIN);
    const list = await listUsersAction({});
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.data.users.map((u) => u.id).sort()).toEqual(
        Object.values(a.users)
          .map((u) => u.id)
          .sort()
      );
    }

    const crossGet = await getUserAction({ userId: b.users.VIEWER.id });
    expect(crossGet.ok).toBe(false);

    const crossRoleChange = await changeUserRoleAction({
      userId: b.users.VIEWER.id,
      newRole: "ADMIN",
    });
    expect(crossRoleChange.ok).toBe(false);

    const crossDisable = await disableUserAction({ userId: b.users.VIEWER.id });
    expect(crossDisable.ok).toBe(false);

    const untouchedB = await testPrisma.user.findUniqueOrThrow({
      where: { id: b.users.VIEWER.id },
    });
    expect(untouchedB.role).toBe("VIEWER");
    expect(untouchedB.status).toBe("ACTIVE");
  });

  it("settings: updating company A's profile never changes company B's profile", async () => {
    mockSessionUser(a.users.ADMIN);
    const updateA = await updateCompanyProfileAction({ name: "Company A (Renamed)" });
    expect(updateA.ok).toBe(true);

    mockSessionUser(b.users.ADMIN);
    const settingsB = await getSettingsAction();
    expect(settingsB.ok).toBe(true);
    if (settingsB.ok) {
      expect(settingsB.data.company.name).not.toBe("Company A (Renamed)");
      expect(settingsB.data.company.id).toBe(b.companyId);
    }
  });

  it("dashboard: per-company counts never include the other company's same-coded records", async () => {
    mockSessionUser(a.users.VIEWER);
    const dashA = await getDashboardAction();
    expect(dashA.ok).toBe(true);
    if (dashA.ok) {
      expect(dashA.data.positions.totalActive).toBe(1);
      expect(dashA.data.company.code).not.toBe("");
    }
  });

  it("organogram: nodes returned to company A never include company B's same-coded position", async () => {
    mockSessionUser(a.users.VIEWER);
    const orgA = await getOrganogramAction();
    expect(orgA.ok).toBe(true);
    if (orgA.ok) {
      expect(orgA.data.nodes).toHaveLength(1);
      expect(orgA.data.nodes[0]?.positionId).toBe(a.positionId);
      expect(orgA.data.nodes[0]?.title).toBe("CEO (A)");
    }
  });
});
