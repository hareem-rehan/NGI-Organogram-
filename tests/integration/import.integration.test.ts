import { afterEach, describe, expect, it, vi } from "vitest";

import { testPrisma } from "./setup";
import {
  makeChildPosition,
  makeCompany,
  makeDepartment,
  makeEmployee,
  makeRootPosition,
  makeUser,
} from "./fixtures";
import {
  confirmImportJob,
  executeImportJob,
  uploadImportFile,
  validateImportJob,
} from "@/lib/services/import.service";
import { queryAuditEvents } from "@/lib/services/audit.service";

function csvBuffer(text: string): Buffer {
  return Buffer.from(text, "utf-8");
}

async function runFullImport(params: {
  companyId: string;
  userId: string;
  importType: "DEPARTMENT" | "POSITION" | "EMPLOYEE" | "ASSIGNMENT";
  importMode: "CREATE_ONLY" | "UPSERT";
  csv: string;
  filename?: string;
}) {
  const uploaded = await uploadImportFile({
    companyId: params.companyId,
    userId: params.userId,
    importType: params.importType,
    importMode: params.importMode,
    originalFilename: params.filename ?? "import.csv",
    fileBuffer: csvBuffer(params.csv),
  });
  const validated = await validateImportJob(uploaded.id, params.companyId);
  return { uploaded, validated };
}

describe("CSV import service — end-to-end against a real database", () => {
  afterEach(() => vi.restoreAllMocks());

  it("Department import: CREATE, then UPDATE, then UNCHANGED across three separate imports", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id);

    const created = await runFullImport({
      companyId: company.id,
      userId: user.id,
      importType: "DEPARTMENT",
      importMode: "UPSERT",
      csv: "departmentCode,departmentName\nSALES,Sales\n",
    });
    expect(created.validated.status).toBe("VALIDATED");
    await confirmImportJob(created.validated.id, company.id, false);
    const executed = await executeImportJob(created.validated.id, company.id);
    expect(executed.job.status).toBe("COMPLETED");
    expect(executed.job.createCount).toBe(1);

    const dept = await testPrisma.department.findFirstOrThrow({
      where: { companyId: company.id, code: "SALES" },
    });
    expect(dept.name).toBe("Sales");

    const updated = await runFullImport({
      companyId: company.id,
      userId: user.id,
      importType: "DEPARTMENT",
      importMode: "UPSERT",
      csv: "departmentCode,departmentName\nSALES,Sales Team\n",
    });
    await confirmImportJob(updated.validated.id, company.id, false);
    const executedUpdate = await executeImportJob(updated.validated.id, company.id);
    expect(executedUpdate.job.status).toBe("COMPLETED");
    expect(executedUpdate.job.updateCount).toBe(1);
    const deptAfterUpdate = await testPrisma.department.findFirstOrThrow({
      where: { id: dept.id },
    });
    expect(deptAfterUpdate.name).toBe("Sales Team");

    const unchanged = await runFullImport({
      companyId: company.id,
      userId: user.id,
      importType: "DEPARTMENT",
      importMode: "UPSERT",
      csv: "departmentCode,departmentName\nSALES,Sales Team\n",
    });
    expect(unchanged.validated.unchangedCount).toBe(1);
    await confirmImportJob(unchanged.validated.id, company.id, false);
    const executedUnchanged = await executeImportJob(unchanged.validated.id, company.id);
    expect(executedUnchanged.job.status).toBe("COMPLETED");
    expect(executedUnchanged.job.unchangedCount).toBe(1);
  });

  it("a full import records IMPORT_VALIDATED then IMPORT_EXECUTED audit events, correlated by the job id, attributed to the requesting user, and never storing raw CSV content", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id);

    const { validated } = await runFullImport({
      companyId: company.id,
      userId: user.id,
      importType: "DEPARTMENT",
      importMode: "UPSERT",
      csv: "departmentCode,departmentName\nAUDIT,Audit Team\n",
    });
    await confirmImportJob(validated.id, company.id, false);
    const executed = await executeImportJob(validated.id, company.id);
    expect(executed.job.status).toBe("COMPLETED");

    const events = await queryAuditEvents({
      companyId: company.id,
      role: "ADMIN",
      importJobId: validated.id,
    });
    const actions = events.events.map((e) => e.action).sort();
    expect(actions).toContain("IMPORT_VALIDATED");
    expect(actions).toContain("IMPORT_EXECUTED");
    for (const event of events.events) {
      expect(event.correlationId).toBe(validated.id);
      expect(event.actorUserId).toBe(user.id);
      expect(JSON.stringify(event.safeMetadata ?? {})).not.toContain("AUDIT,Audit Team");
      expect(JSON.stringify(event.safeMetadata ?? {})).not.toContain("departmentCode");
    }
  });

  it("a rejected (VALIDATION_FAILED) import still records an IMPORT_FAILED audit event", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id);
    await makeDepartment(company.id, { code: "DUP" });

    const { validated } = await runFullImport({
      companyId: company.id,
      userId: user.id,
      importType: "DEPARTMENT",
      importMode: "CREATE_ONLY",
      csv: "departmentCode,departmentName\nDUP,Duplicate\n",
    });
    expect(validated.status).toBe("VALIDATION_FAILED");

    const events = await queryAuditEvents({
      companyId: company.id,
      role: "ADMIN",
      importJobId: validated.id,
    });
    expect(events.events.map((e) => e.action)).toContain("IMPORT_FAILED");
  });

  it("Position import: builds a root+child hierarchy in one file, correctly computing organizationalLevel", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id);
    await makeDepartment(company.id, { code: "EXEC" });
    await makeDepartment(company.id, { code: "ENG" });

    const { validated } = await runFullImport({
      companyId: company.id,
      userId: user.id,
      importType: "POSITION",
      importMode: "UPSERT",
      csv:
        "positionCode,positionTitle,departmentCode,primaryManagerPositionCode\n" +
        "VPENG,VP Engineering,ENG,CEO\nCEO,Chief Executive,EXEC,__ROOT__\n",
    });
    expect(validated.status).toBe("VALIDATED");
    await confirmImportJob(validated.id, company.id, false);
    const executed = await executeImportJob(validated.id, company.id);
    expect(executed.job.status).toBe("COMPLETED");
    expect(executed.job.createCount).toBe(2);

    const ceo = await testPrisma.position.findFirstOrThrow({
      where: { companyId: company.id, positionCode: "CEO" },
    });
    const vpEng = await testPrisma.position.findFirstOrThrow({
      where: { companyId: company.id, positionCode: "VPENG" },
    });
    expect(ceo.organizationalLevel).toBe(1);
    expect(ceo.primaryReportsToPositionId).toBeNull();
    expect(vpEng.organizationalLevel).toBe(2);
    expect(vpEng.primaryReportsToPositionId).toBe(ceo.id);
  });

  it("Position import: a 4-level chain, listed out of order, gets correct levels via the bulk-create path (Phase 13.1)", async () => {
    // Regression test for `applyPositionCreatesBulk`'s dependency layering
    // (Phase 13.1, DEF-009 remediation): the existing root+child test above
    // only exercises 2 layers. This file is deliberately listed in
    // shuffled order and goes 4 levels deep (CEO -> VP -> DIR -> MGR), to
    // prove `layerRowsByDependency` correctly resolves a chain longer than
    // one dependency hop and that `calculateLevel` is applied per-layer,
    // not just to the first wave.
    const company = await makeCompany();
    const user = await makeUser(company.id);
    await makeDepartment(company.id, { code: "EXEC" });

    const { validated } = await runFullImport({
      companyId: company.id,
      userId: user.id,
      importType: "POSITION",
      importMode: "UPSERT",
      csv:
        "positionCode,positionTitle,departmentCode,primaryManagerPositionCode\n" +
        "MGR,Manager,EXEC,DIR\n" +
        "CEO,Chief Executive,EXEC,__ROOT__\n" +
        "DIR,Director,EXEC,VP\n" +
        "VP,Vice President,EXEC,CEO\n",
    });
    expect(validated.status).toBe("VALIDATED");
    await confirmImportJob(validated.id, company.id, false);
    const executed = await executeImportJob(validated.id, company.id);
    expect(executed.job.status).toBe("COMPLETED");
    expect(executed.job.createCount).toBe(4);

    const byCode = async (code: string) =>
      testPrisma.position.findFirstOrThrow({
        where: { companyId: company.id, positionCode: code },
      });
    const [ceo, vp, dir, mgr] = await Promise.all([
      byCode("CEO"),
      byCode("VP"),
      byCode("DIR"),
      byCode("MGR"),
    ]);
    expect(ceo.organizationalLevel).toBe(1);
    expect(ceo.primaryReportsToPositionId).toBeNull();
    expect(vp.organizationalLevel).toBe(2);
    expect(vp.primaryReportsToPositionId).toBe(ceo.id);
    expect(dir.organizationalLevel).toBe(3);
    expect(dir.primaryReportsToPositionId).toBe(vp.id);
    expect(mgr.organizationalLevel).toBe(4);
    expect(mgr.primaryReportsToPositionId).toBe(dir.id);
  });

  it("Position import: an UPDATE row moving an existing position under a position CREATED in the same batch resolves correctly (Phase 13.1 bulk-create + per-row update ordering)", async () => {
    // Regression test for `applyOrderedRows`'s "bulk-create every CREATE
    // row first, then apply remaining UPDATE rows" ordering: proves an
    // UPDATE row that references a same-file CREATE row's code (not yet
    // existing in the DB before this execution) resolves correctly, since
    // the CREATE half of the batch is fully committed (within the
    // transaction) before any UPDATE row runs. Uses an existing NON-root
    // position for the UPDATE row — moving an existing ROOT while
    // simultaneously creating a new root in the same batch is a separate,
    // pre-existing (not Phase 13.1) ordering limitation of this import
    // pipeline unrelated to DEF-009, out of this regression test's scope.
    const company = await makeCompany();
    const user = await makeUser(company.id);
    const execDept = await makeDepartment(company.id, { code: "EXEC" });
    const existingRoot = await makeRootPosition(company.id, execDept.id, {
      positionCode: "CEO",
      title: "Chief Executive",
    });
    const existingChild = await makeChildPosition(
      company.id,
      execDept.id,
      existingRoot.id,
      existingRoot.organizationalLevel,
      { positionCode: "LEGACY", title: "Legacy Report" }
    );

    const { validated } = await runFullImport({
      companyId: company.id,
      userId: user.id,
      importType: "POSITION",
      importMode: "UPSERT",
      csv:
        "positionCode,positionTitle,departmentCode,primaryManagerPositionCode\n" +
        "NEWMGR,New Manager,EXEC,CEO\n" +
        `${existingChild.positionCode},Legacy Report,EXEC,NEWMGR\n`,
    });
    expect(validated.status).toBe("VALIDATED");
    await confirmImportJob(validated.id, company.id, false);
    const executed = await executeImportJob(validated.id, company.id);
    expect(executed.job.status).toBe("COMPLETED");
    expect(executed.job.createCount).toBe(1);
    expect(executed.job.updateCount).toBe(1);

    const newMgr = await testPrisma.position.findFirstOrThrow({
      where: { companyId: company.id, positionCode: "NEWMGR" },
    });
    const legacy = await testPrisma.position.findFirstOrThrow({
      where: { companyId: company.id, positionCode: existingChild.positionCode },
    });
    expect(newMgr.primaryReportsToPositionId).toBe(existingRoot.id);
    expect(newMgr.organizationalLevel).toBe(existingRoot.organizationalLevel + 1);
    expect(legacy.primaryReportsToPositionId).toBe(newMgr.id);
    expect(legacy.organizationalLevel).toBe(newMgr.organizationalLevel + 1);
  });

  it("Employee import: creates a new employee with the given fields", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id);

    const { validated } = await runFullImport({
      companyId: company.id,
      userId: user.id,
      importType: "EMPLOYEE",
      importMode: "UPSERT",
      csv: "employeeCode,firstName,lastName,workEmail\nEMP100,Amara,Diallo,amara@example.test\n",
    });
    await confirmImportJob(validated.id, company.id, false);
    const executed = await executeImportJob(validated.id, company.id);
    expect(executed.job.status).toBe("COMPLETED");

    const employee = await testPrisma.employee.findFirstOrThrow({
      where: { companyId: company.id, employeeCode: "EMP100" },
    });
    expect(employee.firstName).toBe("Amara");
    expect(employee.workEmail).toBe("amara@example.test");
  });

  it("Assignment import: ASSIGN creates a real, correctly-dated PositionAssignment", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id);
    const dept = await makeDepartment(company.id);
    const position = await makeRootPosition(company.id, dept.id, { positionCode: "CEO" });
    const employee = await makeEmployee(company.id, { employeeCode: "EMP200" });

    const { validated } = await runFullImport({
      companyId: company.id,
      userId: user.id,
      importType: "ASSIGNMENT",
      importMode: "UPSERT",
      csv: "operation,employeeCode,positionCode,effectiveDate\nASSIGN,EMP200,CEO,2026-01-01\n",
    });
    expect(validated.status).toBe("VALIDATED");
    await confirmImportJob(validated.id, company.id, false);
    const executed = await executeImportJob(validated.id, company.id);
    expect(executed.job.status).toBe("COMPLETED");

    const assignment = await testPrisma.positionAssignment.findFirstOrThrow({
      where: { companyId: company.id, employeeId: employee.id, positionId: position.id },
    });
    expect(assignment.endDate).toBeNull();
    expect(assignment.startDate.toISOString().slice(0, 10)).toBe("2026-01-01");
  });

  it("a validation error (duplicate code) blocks execution entirely — no data is ever written", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id);

    const { validated } = await runFullImport({
      companyId: company.id,
      userId: user.id,
      importType: "DEPARTMENT",
      importMode: "UPSERT",
      csv: "departmentCode,departmentName\nSALES,Sales\nSALES,Sales Again\n",
    });
    expect(validated.status).toBe("VALIDATION_FAILED");

    await expect(confirmImportJob(validated.id, company.id, false)).rejects.toThrow();
    await expect(executeImportJob(validated.id, company.id)).rejects.toThrow();

    const count = await testPrisma.department.count({ where: { companyId: company.id } });
    expect(count).toBe(0);
  });

  it("execution is rejected for a job that has not been confirmed (still VALIDATED, not READY_TO_EXECUTE)", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id);

    const { validated } = await runFullImport({
      companyId: company.id,
      userId: user.id,
      importType: "DEPARTMENT",
      importMode: "UPSERT",
      csv: "departmentCode,departmentName\nSALES,Sales\n",
    });
    await expect(executeImportJob(validated.id, company.id)).rejects.toThrow();
    const count = await testPrisma.department.count({ where: { companyId: company.id } });
    expect(count).toBe(0);
  });

  it("stale validation: a conflicting record created after validation but before execution aborts the whole batch, with nothing applied", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id);

    const { validated } = await runFullImport({
      companyId: company.id,
      userId: user.id,
      importType: "DEPARTMENT",
      importMode: "CREATE_ONLY",
      csv: "departmentCode,departmentName\nSALES,Sales\nMKT,Marketing\n",
    });
    expect(validated.status).toBe("VALIDATED");
    await confirmImportJob(validated.id, company.id, false);

    // Simulate a real race: someone else creates "SALES" directly through
    // the normal app flow between validation and execution.
    await makeDepartment(company.id, { code: "SALES", name: "Sales (created out of band)" });

    const executed = await executeImportJob(validated.id, company.id);
    expect(executed.stale).toBe(true);
    expect(executed.job.status).toBe("VALIDATION_FAILED");

    // Neither "SALES" (now a CREATE_ONLY conflict) nor "MKT" (a
    // perfectly valid row on its own) was created by the import — the
    // whole batch was aborted before any row was applied, per Critical
    // Safety Principle 6.
    const mkt = await testPrisma.department.findFirst({
      where: { companyId: company.id, code: "MKT" },
    });
    expect(mkt).toBeNull();
    const salesCount = await testPrisma.department.count({
      where: { companyId: company.id, code: "SALES" },
    });
    expect(salesCount).toBe(1); // only the out-of-band one, not a duplicate from the import
  });

  it("a genuine mid-batch failure rolls back every row in the batch, not just the failing one", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id);

    // Phase 13.1 (DEF-009 remediation): DEPARTMENT CREATE rows are now
    // applied via one bulk `createManyAndReturn` per dependency layer/chunk
    // (lib/services/import.service.ts's `applyDepartmentCreatesBulk`), not
    // one `createDepartment` call per row — mocking `createDepartment`
    // itself no longer exercises the apply path at all. `recordAuditEventsBatch`
    // is the next step in that same path, called AFTER the bulk INSERT has
    // already run (within the still-open transaction) — throwing here
    // simulates a failure that strikes *after* real writes already
    // happened in this transaction, which is the harder, more realistic
    // version of "does a late failure still roll back everything already
    // written," not a weaker test than the one it replaces.
    const auditService = await import("@/lib/services/audit.service");
    vi.spyOn(auditService, "recordAuditEventsBatch").mockImplementation(async () => {
      throw new Error("Simulated transient failure after the bulk insert.");
    });

    const { validated } = await runFullImport({
      companyId: company.id,
      userId: user.id,
      importType: "DEPARTMENT",
      importMode: "UPSERT",
      csv: "departmentCode,departmentName\nALPHA,Alpha\nBETA,Beta\n",
    });
    expect(validated.status).toBe("VALIDATED");
    await confirmImportJob(validated.id, company.id, false);

    await expect(executeImportJob(validated.id, company.id)).rejects.toThrow(
      "Simulated transient failure"
    );

    // Both ALPHA and BETA's rows were already inserted (in-transaction) by
    // the bulk createManyAndReturn call before the audit-batch write threw
    // — proving the whole transaction, not just the audit write, rolled
    // back is the entire point of this test.
    const count = await testPrisma.department.count({ where: { companyId: company.id } });
    expect(count).toBe(0);

    const job = await testPrisma.importJob.findUniqueOrThrow({ where: { id: validated.id } });
    expect(job.status).toBe("FAILED");
  });

  it("executing an already-COMPLETED job again is idempotent — it does not re-apply or duplicate data", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id);

    const { validated } = await runFullImport({
      companyId: company.id,
      userId: user.id,
      importType: "DEPARTMENT",
      importMode: "UPSERT",
      csv: "departmentCode,departmentName\nSALES,Sales\n",
    });
    await confirmImportJob(validated.id, company.id, false);
    const firstRun = await executeImportJob(validated.id, company.id);
    expect(firstRun.job.status).toBe("COMPLETED");

    const secondRun = await executeImportJob(validated.id, company.id);
    expect(secondRun.job.status).toBe("COMPLETED");
    expect(secondRun.job.id).toBe(firstRun.job.id);

    const count = await testPrisma.department.count({
      where: { companyId: company.id, code: "SALES" },
    });
    expect(count).toBe(1);
  });

  it("a job from a different company is never visible or executable (company isolation)", async () => {
    const companyA = await makeCompany();
    const companyB = await makeCompany();
    const userA = await makeUser(companyA.id);

    const { validated } = await runFullImport({
      companyId: companyA.id,
      userId: userA.id,
      importType: "DEPARTMENT",
      importMode: "UPSERT",
      csv: "departmentCode,departmentName\nSALES,Sales\n",
    });

    await expect(confirmImportJob(validated.id, companyB.id, false)).rejects.toThrow();
    await expect(executeImportJob(validated.id, companyB.id)).rejects.toThrow();

    const leakedCount = await testPrisma.department.count({ where: { companyId: companyB.id } });
    expect(leakedCount).toBe(0);
  });

  it("CREATE_ONLY mode rejects a row matching an existing code, both at validation and at execution-time revalidation", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id);
    await makeDepartment(company.id, { code: "SALES", name: "Existing Sales" });

    const { validated } = await runFullImport({
      companyId: company.id,
      userId: user.id,
      importType: "DEPARTMENT",
      importMode: "CREATE_ONLY",
      csv: "departmentCode,departmentName\nSALES,New Sales\n",
    });
    expect(validated.status).toBe("VALIDATION_FAILED");

    const issues = await testPrisma.importRowIssue.findMany({
      where: { importJobId: validated.id },
    });
    expect(issues.some((i) => i.code === "CREATE_ONLY_CONFLICT")).toBe(true);

    const existing = await testPrisma.department.findFirstOrThrow({
      where: { companyId: company.id, code: "SALES" },
    });
    expect(existing.name).toBe("Existing Sales");
  });

  it("warnings require explicit acknowledgement before a job can be confirmed", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id);

    const { validated } = await runFullImport({
      companyId: company.id,
      userId: user.id,
      importType: "DEPARTMENT",
      importMode: "UPSERT",
      csv: "departmentCode,departmentName,someUnrecognizedColumn\nSALES,Sales,x\n",
    });
    expect(validated.status).toBe("VALIDATED");
    expect(validated.warningRows).toBeGreaterThan(0);

    await expect(confirmImportJob(validated.id, company.id, false)).rejects.toThrow();
    const confirmed = await confirmImportJob(validated.id, company.id, true);
    expect(confirmed.status).toBe("READY_TO_EXECUTE");
  });

  it("an empty file is rejected before any row processing, with a clear top-level error", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id);

    await expect(
      uploadImportFile({
        companyId: company.id,
        userId: user.id,
        importType: "DEPARTMENT",
        importMode: "UPSERT",
        originalFilename: "empty.csv",
        fileBuffer: Buffer.from("", "utf-8"),
      })
    ).rejects.toThrow();
  });

  it("a malformed CSV (missing required headers) fails validation cleanly, not a crash", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id);

    const { validated } = await runFullImport({
      companyId: company.id,
      userId: user.id,
      importType: "DEPARTMENT",
      importMode: "UPSERT",
      csv: "wrongHeader\nsomevalue\n",
    });
    expect(validated.status).toBe("VALIDATION_FAILED");
    const issues = await testPrisma.importRowIssue.findMany({
      where: { importJobId: validated.id },
    });
    expect(issues.length).toBeGreaterThan(0);
  });
});
