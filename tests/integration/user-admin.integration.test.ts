import { describe, expect, it } from "vitest";

import { testPrisma } from "./setup";
import { makeCompany, makeEmployee, makeUser } from "./fixtures";
import {
  ConflictError,
  DomainValidationError,
  LastAdminError,
  NotFoundError,
  StaleUpdateError,
} from "@/lib/domain/errors";
import {
  changeUserRole,
  disableUser,
  linkEmployee,
  listUsers,
  provisionUser,
  reactivateUser,
  unlinkEmployee,
} from "@/lib/services/user-admin.service";
import { queryAuditEvents } from "@/lib/services/audit.service";

function actorFor(user: { id: string; name: string | null; email: string }) {
  return { userId: user.id, displayName: user.name, email: user.email };
}

describe("user-admin.service — provisioning", () => {
  it("provisions an ADMIN, HR_EDITOR, and VIEWER, each with no password field and an audit event", async () => {
    const company = await makeCompany();
    const admin = await makeUser(company.id, { role: "ADMIN" });
    const actor = actorFor(admin);

    for (const role of ["ADMIN", "HR_EDITOR", "VIEWER"] as const) {
      const created = await provisionUser({
        companyId: company.id,
        actor,
        email: `new-${role.toLowerCase()}@northwind-example.test`,
        role,
      });
      expect(created.role).toBe(role);
      expect(created.status).toBe("ACTIVE");
      expect(created).not.toHaveProperty("passwordHash");

      const events = await queryAuditEvents({
        companyId: company.id,
        role: "ADMIN",
        entityId: created.id,
      });
      expect(events.events[0]?.action).toBe("USER_PROVISIONED");
      expect(events.events[0]?.category).toBe("USER_ADMINISTRATION");
    }
  });

  it("rejects a duplicate email", async () => {
    const company = await makeCompany();
    const admin = await makeUser(company.id, { role: "ADMIN" });
    await provisionUser({
      companyId: company.id,
      actor: actorFor(admin),
      email: "dup@northwind-example.test",
      role: "VIEWER",
    });
    await expect(
      provisionUser({
        companyId: company.id,
        actor: actorFor(admin),
        email: "dup@northwind-example.test",
        role: "VIEWER",
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects an email whose domain is not allow-listed", async () => {
    const company = await makeCompany();
    const admin = await makeUser(company.id, { role: "ADMIN" });
    await expect(
      provisionUser({
        companyId: company.id,
        actor: actorFor(admin),
        email: "someone@not-allowed-domain.test",
        role: "VIEWER",
      })
    ).rejects.toThrow();
  });

  it("provisioning with a linkedEmployeeId links immediately, but never for a terminated employee", async () => {
    const company = await makeCompany();
    const admin = await makeUser(company.id, { role: "ADMIN" });
    const employee = await makeEmployee(company.id);

    const created = await provisionUser({
      companyId: company.id,
      actor: actorFor(admin),
      email: "linked@northwind-example.test",
      role: "VIEWER",
      linkedEmployeeId: employee.id,
    });
    expect(created.linkedEmployeeId).toBe(employee.id);

    await testPrisma.employee.update({
      where: { id: employee.id },
      data: { employmentStatus: "TERMINATED" },
    });
    const terminatedEmployee = await makeEmployee(company.id, { employeeCode: "TERM1" });
    await testPrisma.employee.update({
      where: { id: terminatedEmployee.id },
      data: { employmentStatus: "TERMINATED" },
    });

    await expect(
      provisionUser({
        companyId: company.id,
        actor: actorFor(admin),
        email: "linked2@northwind-example.test",
        role: "VIEWER",
        linkedEmployeeId: terminatedEmployee.id,
      })
    ).rejects.toBeInstanceOf(DomainValidationError);
  });
});

describe("user-admin.service — role changes and last-admin protection", () => {
  it("changes a role and records old/new in the audit event", async () => {
    const company = await makeCompany();
    const admin = await makeUser(company.id, { role: "ADMIN" });
    const viewer = await makeUser(company.id, { role: "VIEWER" });

    const updated = await changeUserRole({
      userId: viewer.id,
      companyId: company.id,
      actor: actorFor(admin),
      newRole: "HR_EDITOR",
    });
    expect(updated.role).toBe("HR_EDITOR");

    const events = await queryAuditEvents({
      companyId: company.id,
      role: "ADMIN",
      entityId: viewer.id,
    });
    const event = events.events.find((e) => e.action === "ROLE_CHANGED");
    expect((event?.beforeData as Record<string, unknown> | null)?.role).toBe("VIEWER");
    expect((event?.afterData as Record<string, unknown> | null)?.role).toBe("HR_EDITOR");
  });

  it("prevents demoting the last active ADMIN", async () => {
    const company = await makeCompany();
    const onlyAdmin = await makeUser(company.id, { role: "ADMIN" });

    await expect(
      changeUserRole({
        userId: onlyAdmin.id,
        companyId: company.id,
        actor: actorFor(onlyAdmin),
        newRole: "HR_EDITOR",
      })
    ).rejects.toBeInstanceOf(LastAdminError);

    const stillAdmin = await testPrisma.user.findUniqueOrThrow({ where: { id: onlyAdmin.id } });
    expect(stillAdmin.role).toBe("ADMIN");
  });

  it("allows self-demotion when another active ADMIN remains", async () => {
    const company = await makeCompany();
    const admin1 = await makeUser(company.id, { role: "ADMIN" });
    await makeUser(company.id, { role: "ADMIN" });

    const updated = await changeUserRole({
      userId: admin1.id,
      companyId: company.id,
      actor: actorFor(admin1),
      newRole: "HR_EDITOR",
    });
    expect(updated.role).toBe("HR_EDITOR");
  });

  it("prevents disabling the last active ADMIN", async () => {
    const company = await makeCompany();
    const onlyAdmin = await makeUser(company.id, { role: "ADMIN" });

    await expect(
      disableUser({ userId: onlyAdmin.id, companyId: company.id, actor: actorFor(onlyAdmin) })
    ).rejects.toBeInstanceOf(LastAdminError);
  });

  it("a non-admin-role active user can be disabled without triggering last-admin protection", async () => {
    const company = await makeCompany();
    const admin = await makeUser(company.id, { role: "ADMIN" });
    const viewer = await makeUser(company.id, { role: "VIEWER" });

    const disabled = await disableUser({
      userId: viewer.id,
      companyId: company.id,
      actor: actorFor(admin),
    });
    expect(disabled.status).toBe("DISABLED");
  });

  it("disabling a user deletes their sessions and records USER_DISABLED", async () => {
    const company = await makeCompany();
    const admin = await makeUser(company.id, { role: "ADMIN" });
    const viewer = await makeUser(company.id, { role: "VIEWER" });
    await testPrisma.session.create({
      data: {
        userId: viewer.id,
        sessionToken: `token-${viewer.id}`,
        expires: new Date(Date.now() + 86400000),
      },
    });

    await disableUser({ userId: viewer.id, companyId: company.id, actor: actorFor(admin) });

    const sessions = await testPrisma.session.findMany({ where: { userId: viewer.id } });
    expect(sessions).toHaveLength(0);

    const events = await queryAuditEvents({
      companyId: company.id,
      role: "ADMIN",
      entityId: viewer.id,
    });
    expect(events.events.map((e) => e.action)).toContain("USER_DISABLED");
  });

  it("reactivating a disabled user never elevates their role", async () => {
    const company = await makeCompany();
    const admin = await makeUser(company.id, { role: "ADMIN" });
    const viewer = await makeUser(company.id, { role: "VIEWER" });
    await disableUser({ userId: viewer.id, companyId: company.id, actor: actorFor(admin) });

    const reactivated = await reactivateUser({
      userId: viewer.id,
      companyId: company.id,
      actor: actorFor(admin),
    });
    expect(reactivated.status).toBe("ACTIVE");
    expect(reactivated.role).toBe("VIEWER");
  });

  it("two concurrent attempts to disable two different admins (leaving zero) — only one succeeds, the other is rejected", async () => {
    const company = await makeCompany();
    const admin1 = await makeUser(company.id, { role: "ADMIN" });
    const admin2 = await makeUser(company.id, { role: "ADMIN" });

    const results = await Promise.allSettled([
      disableUser({ userId: admin1.id, companyId: company.id, actor: actorFor(admin1) }),
      disableUser({ userId: admin2.id, companyId: company.id, actor: actorFor(admin2) }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(LastAdminError);

    const remainingActiveAdmins = await testPrisma.user.count({
      where: { companyId: company.id, role: "ADMIN", status: "ACTIVE" },
    });
    expect(remainingActiveAdmins).toBe(1);
  });

  it("rejects a stale role-change request whose expectedUpdatedAt no longer matches", async () => {
    const company = await makeCompany();
    const admin = await makeUser(company.id, { role: "ADMIN" });
    const viewer = await makeUser(company.id, { role: "VIEWER" });

    await changeUserRole({
      userId: viewer.id,
      companyId: company.id,
      actor: actorFor(admin),
      newRole: "HR_EDITOR",
    });

    await expect(
      changeUserRole({
        userId: viewer.id,
        companyId: company.id,
        actor: actorFor(admin),
        newRole: "ADMIN",
        expectedUpdatedAt: viewer.updatedAt, // the ORIGINAL (now-stale) timestamp
      })
    ).rejects.toBeInstanceOf(StaleUpdateError);
  });

  it("never resolves a user belonging to a different company", async () => {
    const companyA = await makeCompany();
    const companyB = await makeCompany();
    const admin = await makeUser(companyA.id, { role: "ADMIN" });
    const otherUser = await makeUser(companyB.id, { role: "VIEWER" });

    await expect(
      changeUserRole({
        userId: otherUser.id,
        companyId: companyA.id,
        actor: actorFor(admin),
        newRole: "ADMIN",
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("user-admin.service — Employee linking", () => {
  it("links and unlinks without changing role, assignment, or employment status", async () => {
    const company = await makeCompany();
    const admin = await makeUser(company.id, { role: "ADMIN" });
    const viewer = await makeUser(company.id, { role: "VIEWER" });
    const employee = await makeEmployee(company.id);

    const linked = await linkEmployee({
      userId: viewer.id,
      companyId: company.id,
      actor: actorFor(admin),
      employeeId: employee.id,
    });
    expect(linked.linkedEmployeeId).toBe(employee.id);
    expect(linked.role).toBe("VIEWER");

    const unlinked = await unlinkEmployee({
      userId: viewer.id,
      companyId: company.id,
      actor: actorFor(admin),
    });
    expect(unlinked.linkedEmployeeId).toBeNull();
    expect(unlinked.status).toBe("ACTIVE");

    const employeeAfter = await testPrisma.employee.findUniqueOrThrow({
      where: { id: employee.id },
    });
    expect(employeeAfter.employmentStatus).toBe("ACTIVE");
  });

  it("rejects linking to an employee in a different company", async () => {
    const companyA = await makeCompany();
    const companyB = await makeCompany();
    const admin = await makeUser(companyA.id, { role: "ADMIN" });
    const viewer = await makeUser(companyA.id, { role: "VIEWER" });
    const otherEmployee = await makeEmployee(companyB.id);

    await expect(
      linkEmployee({
        userId: viewer.id,
        companyId: companyA.id,
        actor: actorFor(admin),
        employeeId: otherEmployee.id,
      })
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it("rejects linking an employee already linked to another user", async () => {
    const company = await makeCompany();
    const admin = await makeUser(company.id, { role: "ADMIN" });
    const viewer1 = await makeUser(company.id, { role: "VIEWER" });
    const viewer2 = await makeUser(company.id, { role: "VIEWER" });
    const employee = await makeEmployee(company.id);

    await linkEmployee({
      userId: viewer1.id,
      companyId: company.id,
      actor: actorFor(admin),
      employeeId: employee.id,
    });

    await expect(
      linkEmployee({
        userId: viewer2.id,
        companyId: company.id,
        actor: actorFor(admin),
        employeeId: employee.id,
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects linking to a terminated employee", async () => {
    const company = await makeCompany();
    const admin = await makeUser(company.id, { role: "ADMIN" });
    const viewer = await makeUser(company.id, { role: "VIEWER" });
    const employee = await makeEmployee(company.id);
    await testPrisma.employee.update({
      where: { id: employee.id },
      data: { employmentStatus: "TERMINATED" },
    });

    await expect(
      linkEmployee({
        userId: viewer.id,
        companyId: company.id,
        actor: actorFor(admin),
        employeeId: employee.id,
      })
    ).rejects.toBeInstanceOf(DomainValidationError);
  });
});

describe("user-admin.service — listing", () => {
  it("is company-scoped and supports search/role/status/linked filters with pagination", async () => {
    const company = await makeCompany();
    const otherCompany = await makeCompany();
    await makeUser(company.id, { email: "alpha@example.test", role: "ADMIN" });
    await makeUser(company.id, { email: "beta@example.test", role: "VIEWER" });
    await makeUser(otherCompany.id, { email: "gamma@example.test", role: "ADMIN" });

    const all = await listUsers({ companyId: company.id });
    expect(all.total).toBe(2);

    const byRole = await listUsers({ companyId: company.id, role: "ADMIN" });
    expect(byRole.total).toBe(1);
    expect(byRole.users[0]?.email).toBe("alpha@example.test");

    const bySearch = await listUsers({ companyId: company.id, search: "beta" });
    expect(bySearch.total).toBe(1);
  });
});
