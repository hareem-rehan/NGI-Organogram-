import { describe, expect, it } from "vitest";

import { testPrisma } from "./setup";
import { makeCompany, makeUser } from "./fixtures";
import { prisma } from "@/lib/db/prisma";
import { withTransaction } from "@/lib/db/transaction";
import { DomainValidationError, NotFoundError } from "@/lib/domain/errors";
import {
  getAuditEvent,
  queryAuditEvents,
  recordAuditEvent,
  recordAuditEventsBatch,
} from "@/lib/services/audit.service";

describe("audit.service", () => {
  it("records an event with a redacted before/after diff and computed changedFields", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id);

    const event = await recordAuditEvent({
      companyId: company.id,
      actor: { userId: user.id, displayName: user.name, email: user.email },
      action: "UPDATED",
      category: "DEPARTMENT",
      entityType: "Department",
      entityId: "dept-1",
      entityDisplayReference: "ENG",
      before: { id: "dept-1", name: "Engineering", code: "ENG", secretField: "should vanish" },
      after: { id: "dept-1", name: "Engineering Team", code: "ENG", secretField: "should vanish" },
    });

    expect(event.beforeData).toEqual({ id: "dept-1", name: "Engineering", code: "ENG" });
    expect(event.afterData).toEqual({ id: "dept-1", name: "Engineering Team", code: "ENG" });
    expect(event.changedFields).toEqual(["name"]);
    expect(event.actorType).toBe("USER");
    expect(event.actorUserId).toBe(user.id);
    expect(event.actorEmailSnapshot).toBe(user.email);
  });

  it("records a SYSTEM-actor event with null actorUserId", async () => {
    const company = await makeCompany();
    const event = await recordAuditEvent({
      companyId: company.id,
      actor: "SYSTEM",
      action: "IMPORT_EXECUTED",
      category: "IMPORT",
      entityType: "ImportJob",
    });
    expect(event.actorType).toBe("SYSTEM");
    expect(event.actorUserId).toBeNull();
    expect(event.actorDisplayNameSnapshot).toBe("System");
  });

  it("assigns a correlationId automatically when none is given, and reuses one explicitly given across multiple events", async () => {
    const company = await makeCompany();
    const auto = await recordAuditEvent({
      companyId: company.id,
      actor: "SYSTEM",
      action: "CREATED",
      category: "SYSTEM",
      entityType: "Test",
    });
    expect(auto.correlationId).toBeTruthy();

    const correlationId = "shared-correlation-id";
    const a = await recordAuditEvent({
      companyId: company.id,
      actor: "SYSTEM",
      action: "IMPORT_VALIDATED",
      category: "IMPORT",
      entityType: "ImportJob",
      correlationId,
    });
    const b = await recordAuditEvent({
      companyId: company.id,
      actor: "SYSTEM",
      action: "IMPORT_EXECUTED",
      category: "IMPORT",
      entityType: "ImportJob",
      correlationId,
    });
    expect(a.correlationId).toBe(correlationId);
    expect(b.correlationId).toBe(correlationId);
  });

  it("records a batch of events in one call, all sharing the same correlationId", async () => {
    const company = await makeCompany();
    const correlationId = "batch-correlation-id";
    await recordAuditEventsBatch(
      Array.from({ length: 5 }, (_, i) => ({
        companyId: company.id,
        actor: "SYSTEM" as const,
        action: "CREATED" as const,
        category: "DEPARTMENT" as const,
        entityType: "Department",
        entityId: `dept-${i}`,
        correlationId,
      }))
    );
    const result = await queryAuditEvents({ companyId: company.id, role: "ADMIN", correlationId });
    expect(result.total).toBe(5);
  });

  it("a REQUIRED audit write failing inside a caller's transaction rolls back the mutation it documents", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id);

    await expect(
      withTransaction(prisma, async (tx) => {
        await tx.department.create({
          data: { companyId: company.id, name: "Should Not Persist", code: "ROLLBACK-TEST" },
        });
        // Simulate a required audit write failing (e.g. a bug/constraint
        // violation) by passing an invalid enum-shaped call — the point
        // is that ANY failure inside this same transaction rolls back
        // the department create too, since both share one transaction.
        await recordAuditEvent(
          {
            companyId: company.id,
            actor: { userId: user.id, displayName: null, email: null },
            action: "CREATED",
            // @ts-expect-error — deliberately invalid to force a DB-level failure inside the transaction.
            category: "NOT_A_REAL_CATEGORY",
            entityType: "Department",
          },
          tx
        );
      })
    ).rejects.toBeTruthy();

    const survived = await testPrisma.department.findFirst({ where: { code: "ROLLBACK-TEST" } });
    expect(survived).toBeNull();
  });

  it("application layer exposes no update/delete for audit events — direct ORM attempts are rejected by the database trigger", async () => {
    const company = await makeCompany();
    const event = await recordAuditEvent({
      companyId: company.id,
      actor: "SYSTEM",
      action: "CREATED",
      category: "SYSTEM",
      entityType: "Test",
    });

    await expect(
      testPrisma.auditEvent.update({ where: { id: event.id }, data: { entityType: "Hacked" } })
    ).rejects.toThrow(/append-only/i);

    await expect(testPrisma.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow(
      /append-only/i
    );

    const stillThere = await testPrisma.auditEvent.findUnique({ where: { id: event.id } });
    expect(stillThere?.entityType).toBe("Test");
  });

  it("never resolves an event belonging to a different company (company isolation)", async () => {
    const companyA = await makeCompany();
    const companyB = await makeCompany();
    const event = await recordAuditEvent({
      companyId: companyA.id,
      actor: "SYSTEM",
      action: "CREATED",
      category: "SYSTEM",
      entityType: "Test",
    });

    await expect(getAuditEvent(event.id, companyB.id, "ADMIN")).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  it("filters by actor, category, action, entity, and correlationId", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id);
    const otherUser = await makeUser(company.id);

    await recordAuditEvent({
      companyId: company.id,
      actor: { userId: user.id, displayName: null, email: user.email },
      action: "CREATED",
      category: "DEPARTMENT",
      entityType: "Department",
      entityId: "dept-x",
    });
    await recordAuditEvent({
      companyId: company.id,
      actor: { userId: otherUser.id, displayName: null, email: null },
      action: "UPDATED",
      category: "POSITION",
      entityType: "Position",
      entityId: "pos-x",
    });

    const byActor = await queryAuditEvents({
      companyId: company.id,
      role: "ADMIN",
      actorUserId: user.id,
    });
    expect(byActor.total).toBe(1);
    expect(byActor.events[0]?.actorUserId).toBe(user.id);

    const byActorEmail = await queryAuditEvents({
      companyId: company.id,
      role: "ADMIN",
      actorEmailContains: user.email.slice(0, 5),
    });
    expect(byActorEmail.total).toBe(1);
    expect(byActorEmail.events[0]?.actorUserId).toBe(user.id);

    const byCategory = await queryAuditEvents({
      companyId: company.id,
      role: "ADMIN",
      category: "POSITION",
    });
    expect(byCategory.total).toBe(1);
    expect(byCategory.events[0]?.category).toBe("POSITION");

    const byAction = await queryAuditEvents({
      companyId: company.id,
      role: "ADMIN",
      action: "UPDATED",
    });
    expect(byAction.total).toBe(1);

    const byEntity = await queryAuditEvents({
      companyId: company.id,
      role: "ADMIN",
      entityType: "Department",
      entityId: "dept-x",
    });
    expect(byEntity.total).toBe(1);
  });

  it("filters by an occurredAt date range and rejects an inverted range", async () => {
    const company = await makeCompany();
    await recordAuditEvent({
      companyId: company.id,
      actor: "SYSTEM",
      action: "CREATED",
      category: "SYSTEM",
      entityType: "Test",
    });

    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const withinRange = await queryAuditEvents({
      companyId: company.id,
      role: "ADMIN",
      occurredFrom: yesterday,
      occurredTo: tomorrow,
    });
    expect(withinRange.total).toBe(1);

    const outsideRange = await queryAuditEvents({
      companyId: company.id,
      role: "ADMIN",
      occurredFrom: new Date(now.getTime() - 48 * 60 * 60 * 1000),
      occurredTo: yesterday,
    });
    expect(outsideRange.total).toBe(0);

    await expect(
      queryAuditEvents({
        companyId: company.id,
        role: "ADMIN",
        occurredFrom: tomorrow,
        occurredTo: yesterday,
      })
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it("rejects an excessively large date range", async () => {
    const company = await makeCompany();
    await expect(
      queryAuditEvents({
        companyId: company.id,
        role: "ADMIN",
        occurredFrom: new Date("2000-01-01"),
        occurredTo: new Date("2026-01-01"),
      })
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it("paginates with a safe maximum page size and correct total count", async () => {
    const company = await makeCompany();
    await recordAuditEventsBatch(
      Array.from({ length: 12 }, (_, i) => ({
        companyId: company.id,
        actor: "SYSTEM" as const,
        action: "CREATED" as const,
        category: "SYSTEM" as const,
        entityType: "Test",
        entityId: `item-${i}`,
      }))
    );
    const page1 = await queryAuditEvents({
      companyId: company.id,
      role: "ADMIN",
      page: 1,
      pageSize: 5,
    });
    expect(page1.events).toHaveLength(5);
    expect(page1.total).toBe(12);
    const page3 = await queryAuditEvents({
      companyId: company.id,
      role: "ADMIN",
      page: 3,
      pageSize: 5,
    });
    expect(page3.events).toHaveLength(2);

    const overLimit = await queryAuditEvents({
      companyId: company.id,
      role: "ADMIN",
      pageSize: 99999,
    });
    expect(overLimit.pageSize).toBeLessThanOrEqual(100);
  });

  it("sorts newest-first by default", async () => {
    const company = await makeCompany();
    const first = await recordAuditEvent({
      companyId: company.id,
      actor: "SYSTEM",
      action: "CREATED",
      category: "SYSTEM",
      entityType: "Test",
      entityId: "first",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await recordAuditEvent({
      companyId: company.id,
      actor: "SYSTEM",
      action: "CREATED",
      category: "SYSTEM",
      entityType: "Test",
      entityId: "second",
    });
    const result = await queryAuditEvents({ companyId: company.id, role: "ADMIN" });
    expect(result.events[0]?.id).toBe(second.id);
    expect(result.events[1]?.id).toBe(first.id);
  });

  it("restricts HR_EDITOR to organization-change categories — a USER_ADMINISTRATION event is invisible, never an error revealing it exists", async () => {
    const company = await makeCompany();
    const orgEvent = await recordAuditEvent({
      companyId: company.id,
      actor: "SYSTEM",
      action: "CREATED",
      category: "DEPARTMENT",
      entityType: "Department",
    });
    const adminEvent = await recordAuditEvent({
      companyId: company.id,
      actor: "SYSTEM",
      action: "ROLE_CHANGED",
      category: "USER_ADMINISTRATION",
      entityType: "User",
    });

    const hrEditorResult = await queryAuditEvents({ companyId: company.id, role: "HR_EDITOR" });
    const hrEditorIds = hrEditorResult.events.map((e) => e.id);
    expect(hrEditorIds).toContain(orgEvent.id);
    expect(hrEditorIds).not.toContain(adminEvent.id);

    // Explicitly requesting the restricted category yields zero results, not an error.
    const explicitRestricted = await queryAuditEvents({
      companyId: company.id,
      role: "HR_EDITOR",
      category: "USER_ADMINISTRATION",
    });
    expect(explicitRestricted.total).toBe(0);

    await expect(getAuditEvent(adminEvent.id, company.id, "HR_EDITOR")).rejects.toBeInstanceOf(
      NotFoundError
    );
    const adminView = await getAuditEvent(adminEvent.id, company.id, "ADMIN");
    expect(adminView.id).toBe(adminEvent.id);
  });

  it("keeps an audit event readable after its actor user is later removed from the session (deactivated) — snapshot fields remain intact", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id);
    const event = await recordAuditEvent({
      companyId: company.id,
      actor: { userId: user.id, displayName: user.name, email: user.email },
      action: "CREATED",
      category: "DEPARTMENT",
      entityType: "Department",
    });

    await testPrisma.user.update({ where: { id: user.id }, data: { status: "DISABLED" } });

    const fetched = await getAuditEvent(event.id, company.id, "ADMIN");
    expect(fetched.actorEmailSnapshot).toBe(user.email);
    expect(fetched.actorUserId).toBe(user.id);
  });
});
