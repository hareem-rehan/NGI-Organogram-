/**
 * User Acceptance Testing (UAT) seed script — Phase 13 ("Release
 * Hardening"). Populates a second, entirely fictional company
 * ("Brightloop Fictional Co.", company code `UAT-DEMO`) so a non-technical
 * HR tester has a realistic, varied dataset to exercise every feature
 * against without touching (or depending on) `prisma/seed.ts`'s
 * "Northwind Example Co." dataset. Both scripts can be run against the
 * same database — they use different company codes, position/department
 * codes, and employee codes, so nothing collides.
 *
 * All names, emails, and codes below are entirely fictional (CLAUDE.md
 * §1.11) — every code is prefixed `UAT-` specifically so this dataset is
 * never mistaken for real data in an export, the audit log, or a screen
 * share. This is NOT the reference organogram's real data.
 *
 * Unlike `prisma/seed.ts` (which upserts rows directly via Prisma for
 * speed and simplicity), this script deliberately routes department,
 * position, employee, and assignment creation through the SAME
 * `lib/services/*.service.ts` functions the real application UI calls —
 * `createDepartment`, `createPosition`, `createEmployee`,
 * `createAssignment`, `transferEmployee`, `terminateEmployee`,
 * `movePosition`, and `archivePosition` — so this script's own audit
 * trail (`AuditEvent` rows) is generated as a genuine side effect of a
 * real mutation, never fabricated directly (per the Phase 13 task brief
 * and `lib/services/audit.service.ts`'s "the ONE way any service writes
 * an audit event" contract). The one deliberate exception is the two
 * `PLANNED` positions below: `docs/CSV_IMPORT_GUIDE.md` §7 documents that
 * **no service path in this application can produce a `PLANNED`
 * position** (manual entry can't either) — so, exactly like
 * `prisma/seed.ts`'s own `dataAnalyst` position, those two rows are
 * written directly via Prisma, matching what the real app can actually
 * produce (no audit event for them, because no real user action could
 * produce one either).
 *
 * Idempotency: every creation is guarded by a "does this already exist?"
 * check (by natural unique key) before calling the service function, so
 * re-running this script never duplicates data or errors, and never
 * re-emits an audit event for something already created. The three
 * "lifecycle" demonstrations (a transfer, a termination, a hierarchy
 * move, an archive) are each individually guarded the same way, so they
 * fire exactly once across any number of runs.
 *
 * BLOCKED IN PRODUCTION, with NO override flag — stricter than
 * `scripts/provision-user.ts`'s `--yes-i-am-sure-this-is-production`
 * escape hatch. `provision-user.ts` sometimes has a legitimate
 * production use (bootstrapping the very first real ADMIN);
 * auto-generating a fictional company, fictional employees, and
 * ADMIN/HR_EDITOR/VIEWER *demo* accounts never does. This mirrors
 * `prisma/seed.ts`'s own stricter "no override, ever" convention instead
 * — the more dangerous the mistake, the fewer escape hatches it gets.
 *
 * `runUatSeed(db)` takes an explicit PrismaClient, the same convention
 * `prisma/seed.ts` uses, so it can be called directly from a test/CI
 * context without spawning a subprocess. The CLI entry point at the
 * bottom of this file is the only thing that constructs its own client
 * and enforces the environment gate.
 *
 * Run via `npm run db:seed:uat`, NOT a bare `tsx prisma/seed-uat.ts`.
 * Every `lib/services/*.service.ts` module imported below is guarded by
 * the `server-only` package (transitively, via `lib/db/prisma.ts`), which
 * throws under a plain Node/tsx resolution — Next.js only makes it a
 * no-op by setting the "react-server" export condition (via its own
 * bundler), and `vitest.integration.config.mts` replicates that
 * explicitly for the same reason (see its own comment on
 * `resolve.conditions`). `lib/services/integrity-check.service.ts`
 * sidesteps this by deliberately never importing "server-only"; this
 * script instead passes the condition through directly —
 * `tsx --conditions=react-server prisma/seed-uat.ts`, wired into the
 * `db:seed:uat` npm script — since routing through the real service
 * layer (rather than reimplementing audit-writing) was judged more
 * important here than avoiding this one extra flag.
 */
import type { PrismaClient, User, UserRole } from "@prisma/client";

// Relative imports, not the "@/" path alias: `tsx` (unlike Next.js or
// this project's vitest config, which resolves "@/*" via
// `vite-tsconfig-paths`) does not read tsconfig `paths` for a plain CLI
// script — see `scripts/check-domain-integrity.ts` for the same
// established convention this file follows.
import { createDepartment } from "../lib/services/department.service";
import { archivePosition, createPosition, movePosition } from "../lib/services/hierarchy.service";
import { createEmployee, terminateEmployee } from "../lib/services/employee.service";
import { createAssignment, transferEmployee } from "../lib/services/assignment.service";
import type { AuditActor } from "../lib/services/audit.service";

export function assertUatSeedAllowed(env: string | undefined = process.env.NODE_ENV): void {
  if (env !== "development" && env !== "test") {
    throw new Error(
      `Refusing to seed UAT data: NODE_ENV is "${env}", but this script only runs when NODE_ENV ` +
        'is "development" or "test". There is no override flag — a fictional company, fictional ' +
        "employees, and demo ADMIN/HR_EDITOR/VIEWER accounts must never be auto-created against a " +
        "production database, under any circumstance."
    );
  }
}

const COMPANY_CODE = "UAT-DEMO";
const DEFAULT_EMAIL_DOMAIN = "northwind-example.test";

/**
 * The seeded VIEWER/HR_EDITOR/ADMIN demo accounts must use an email
 * domain that is actually allow-listed by whatever environment this
 * script runs against (`AUTH_ALLOWED_EMAIL_DOMAINS` — see
 * `docs/AUTHORIZATION_MATRIX.md` §7), or nobody can ever sign in as them
 * through Company SSO. Rather than hard-coding a guess, this reads the
 * environment's own configured allow-list (first domain listed) and
 * falls back to this repository's existing local-dev/test convention
 * ("northwind-example.test", already set in `.env`/`.env.test`) only
 * when that variable isn't set at all. Uses raw `process.env` (not the
 * Zod-validated `serverEnv`) deliberately, so this script has no
 * dependency on `lib/env.server.ts`'s full validation succeeding for
 * unrelated variables it doesn't need.
 */
function resolveUatEmailDomain(): string {
  const raw = process.env.AUTH_ALLOWED_EMAIL_DOMAINS;
  if (!raw) return DEFAULT_EMAIL_DOMAIN;
  const first = raw
    .split(",")
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  return first ?? DEFAULT_EMAIL_DOMAIN;
}

export async function runUatSeed(db: PrismaClient) {
  const emailDomain = resolveUatEmailDomain();

  // -----------------------------------------------------------------
  // Idempotent "get or create via the real service layer" helpers.
  // Each checks the natural unique key first (mirroring
  // prisma/seed.ts's own upsert-by-natural-key strategy) so a second
  // run never re-creates a row or re-emits an audit event for it.
  // -----------------------------------------------------------------

  async function getOrCreateDepartment(
    code: string,
    data: { name: string; color: string; parentDepartmentId?: string | null; displayOrder: number }
  ) {
    const existing = await db.department.findUnique({
      where: { companyId_code: { companyId: company.id, code } },
    });
    if (existing) return existing;
    return createDepartment(
      {
        companyId: company.id,
        actor: adminActor,
        code,
        name: data.name,
        color: data.color,
        parentDepartmentId: data.parentDepartmentId ?? null,
        displayOrder: data.displayOrder,
      },
      db
    );
  }

  async function getOrCreateJobGrade(code: string, data: { name: string; displayOrder: number }) {
    // No service layer exists for JobGrade (docs/DATA_DICTIONARY.md: it
    // is not an audited entity — AuditCategory has no JOB_GRADE value,
    // and no page/action manages it), so — exactly like
    // prisma/seed.ts's own upsertJobGrade — this writes directly via
    // Prisma, matching what the real application can actually do.
    return db.jobGrade.upsert({
      where: { companyId_code: { companyId: company.id, code } },
      update: {},
      create: {
        companyId: company.id,
        code,
        name: data.name,
        displayOrder: data.displayOrder,
        status: "ACTIVE",
      },
    });
  }

  async function getOrCreatePosition(
    code: string,
    data: {
      title: string;
      departmentId: string;
      jobGradeId: string | null;
      managerId: string | null;
      location?: string | null;
    }
  ) {
    const existing = await db.position.findUnique({
      where: { companyId_positionCode: { companyId: company.id, positionCode: code } },
    });
    if (existing) return existing;
    return createPosition(
      {
        companyId: company.id,
        actor: adminActor,
        positionCode: code,
        title: data.title,
        departmentId: data.departmentId,
        jobGradeId: data.jobGradeId,
        primaryReportsToPositionId: data.managerId,
        location: data.location ?? null,
      },
      db
    );
  }

  /**
   * `docs/CSV_IMPORT_GUIDE.md` §7: no service path (and no manual-entry
   * path either) can create a PLANNED position — it is always
   * lifecycle-locked to ACTIVE on creation, toggled to/from INACTIVE
   * only via archivePosition/activatePosition. A PLANNED demo row is
   * therefore written directly via Prisma, exactly like
   * prisma/seed.ts's own `dataAnalyst` position — this is not a
   * shortcut, it is the only way this state can exist at all, matching
   * the real application's own constraint. No audit event is recorded
   * for it, because no real user action could produce one either.
   */
  async function getOrCreatePlannedPosition(
    code: string,
    data: {
      title: string;
      departmentId: string;
      jobGradeId: string | null;
      managerId: string | null;
      location?: string | null;
    }
  ) {
    const existing = await db.position.findUnique({
      where: { companyId_positionCode: { companyId: company.id, positionCode: code } },
    });
    if (existing) return existing;
    const managerLevel = data.managerId
      ? (await db.position.findUnique({ where: { id: data.managerId } }))?.organizationalLevel
      : null;
    return db.position.create({
      data: {
        companyId: company.id,
        positionCode: code,
        title: data.title,
        departmentId: data.departmentId,
        jobGradeId: data.jobGradeId,
        primaryReportsToPositionId: data.managerId,
        organizationalLevel: (managerLevel ?? 0) + 1,
        location: data.location ?? null,
        status: "PLANNED",
      },
    });
  }

  async function getOrCreateEmployee(
    code: string,
    data: { firstName: string; lastName: string; workEmail: string; joiningDate: Date }
  ) {
    const existing = await db.employee.findUnique({
      where: { companyId_employeeCode: { companyId: company.id, employeeCode: code } },
    });
    if (existing) return existing;
    return createEmployee(
      {
        companyId: company.id,
        actor: adminActor,
        employeeCode: code,
        firstName: data.firstName,
        lastName: data.lastName,
        workEmail: data.workEmail,
        joiningDate: data.joiningDate,
      },
      db
    );
  }

  async function getOrCreateAssignment(
    employeeId: string,
    positionId: string,
    startDate: Date,
    endDate: Date | null = null
  ) {
    const existing = await db.positionAssignment.findFirst({
      where: { companyId: company.id, employeeId, positionId, startDate },
    });
    if (existing) return existing;
    return createAssignment(
      { companyId: company.id, actor: adminActor, employeeId, positionId, startDate, endDate },
      db
    );
  }

  async function getOrCreateUser(email: string, role: UserRole, name: string): Promise<User> {
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) return existing;
    // Plain Prisma create, deliberately mirroring
    // `scripts/provision-user.ts`'s own bootstrap convention (a
    // pre-provisioned User row, no password, no Account, un-audited) —
    // the same reason that CLI's "create-admin"/"add" commands are
    // themselves un-audited (docs/AUDIT_AND_ADMIN_GUIDE.md §12). Using
    // the Phase 12 web-admin `provisionUser` service instead would pull
    // in `lib/env.server.ts`'s full Zod-validated `serverEnv` (it calls
    // `assertEmailDomainAllowed` against it) purely to create a
    // bootstrap fixture — an unnecessary environment-validation
    // dependency for a seed script whose only job here is to reserve
    // three identities.
    return db.user.create({
      data: { email, name, companyId: company.id, role, status: "ACTIVE" },
    });
  }

  // -----------------------------------------------------------------
  // Company
  // -----------------------------------------------------------------

  const company = await db.company.upsert({
    where: { code: COMPANY_CODE },
    update: {},
    create: {
      code: COMPANY_CODE,
      name: "Brightloop Fictional Co.",
      legalName: "Brightloop Fictional Co. (synthetic UAT dataset — not a real company)",
      timezone: "UTC",
      status: "ACTIVE",
    },
  });

  // -----------------------------------------------------------------
  // Demo users — one per role, for UAT sign-in coverage
  // (docs/UAT_PLAN.md explains the Company SSO prerequisite: whoever
  // owns the real deployed Identity Provider must have a matching test
  // account for each of these emails before a human tester can actually
  // sign in as one).
  // -----------------------------------------------------------------

  const adminUser = await getOrCreateUser(`uat.admin@${emailDomain}`, "ADMIN", "Uzo Admin (UAT)");
  const editorUser = await getOrCreateUser(
    `uat.editor@${emailDomain}`,
    "HR_EDITOR",
    "Edie Torres (UAT)"
  );
  await getOrCreateUser(`uat.viewer@${emailDomain}`, "VIEWER", "Vic Alden (UAT)");

  const adminActor: AuditActor = {
    userId: adminUser.id,
    displayName: adminUser.name,
    email: adminUser.email,
  };
  const editorActor: AuditActor = {
    userId: editorUser.id,
    displayName: editorUser.name,
    email: editorUser.email,
  };

  // -----------------------------------------------------------------
  // Departments — a wide set of top-level departments (so the CEO has
  // many direct reports) plus two nested departments under Engineering
  // (so the deep branch below spans two distinct, related departments).
  // -----------------------------------------------------------------

  const exec = await getOrCreateDepartment("UAT-EXEC", {
    name: "Executive",
    color: "#1d4ed8",
    displayOrder: 1,
  });
  const eng = await getOrCreateDepartment("UAT-ENG", {
    name: "Engineering",
    color: "#16a34a",
    displayOrder: 2,
  });
  const sales = await getOrCreateDepartment("UAT-SALES", {
    name: "Sales",
    color: "#ea580c",
    displayOrder: 3,
  });
  const mkt = await getOrCreateDepartment("UAT-MKT", {
    name: "Marketing",
    color: "#db2777",
    displayOrder: 4,
  });
  const fin = await getOrCreateDepartment("UAT-FIN", {
    name: "Finance",
    color: "#7c3aed",
    displayOrder: 5,
  });
  const people = await getOrCreateDepartment("UAT-PEOPLE", {
    name: "People & Culture",
    color: "#0891b2",
    displayOrder: 6,
  });
  const cs = await getOrCreateDepartment("UAT-CS", {
    name: "Customer Success",
    color: "#ca8a04",
    displayOrder: 7,
  });
  const legal = await getOrCreateDepartment("UAT-LEGAL", {
    name: "Legal & Compliance",
    color: "#64748b",
    displayOrder: 8,
  });
  const product = await getOrCreateDepartment("UAT-PRODUCT", {
    name: "Product",
    color: "#059669",
    displayOrder: 9,
  });
  const ops = await getOrCreateDepartment("UAT-OPS", {
    name: "Operations",
    color: "#9333ea",
    displayOrder: 10,
  });

  const engPlatform = await getOrCreateDepartment("UAT-ENG-PLATFORM", {
    name: "Platform Engineering",
    color: "#16a34a",
    parentDepartmentId: eng.id,
    displayOrder: 1,
  });
  const engData = await getOrCreateDepartment("UAT-ENG-DATA", {
    name: "Data Engineering",
    color: "#16a34a",
    parentDepartmentId: eng.id,
    displayOrder: 2,
  });

  // -----------------------------------------------------------------
  // Job grades — six levels, independent of organizational level
  // (CLAUDE.md §2 — never derive one from the other).
  // -----------------------------------------------------------------

  const g1 = await getOrCreateJobGrade("UAT-G1", { name: "Entry-Level", displayOrder: 1 });
  const g2 = await getOrCreateJobGrade("UAT-G2", { name: "Professional", displayOrder: 2 });
  const g3 = await getOrCreateJobGrade("UAT-G3", { name: "Senior Professional", displayOrder: 3 });
  const g4 = await getOrCreateJobGrade("UAT-G4", { name: "Manager", displayOrder: 4 });
  const g5 = await getOrCreateJobGrade("UAT-G5", { name: "Director", displayOrder: 5 });
  const g6 = await getOrCreateJobGrade("UAT-G6", { name: "Executive", displayOrder: 6 });

  // -----------------------------------------------------------------
  // Positions + employees, top-down (a position's manager is always
  // created before the position itself, so `positionByCode` always has
  // the manager available). `employee: null` means the position is an
  // intentional, approved-but-unfilled Vacancy.
  // -----------------------------------------------------------------

  interface EmployeeSpec {
    code: string;
    firstName: string;
    lastName: string;
    joiningDate: string;
  }
  interface PositionSpec {
    code: string;
    title: string;
    deptCode: string;
    gradeCode: string | null;
    managerCode: string | null;
    location?: string;
    employee?: EmployeeSpec | null;
  }

  const deptByCode = new Map([
    ["UAT-EXEC", exec],
    ["UAT-ENG", eng],
    ["UAT-ENG-PLATFORM", engPlatform],
    ["UAT-ENG-DATA", engData],
    ["UAT-SALES", sales],
    ["UAT-MKT", mkt],
    ["UAT-FIN", fin],
    ["UAT-PEOPLE", people],
    ["UAT-CS", cs],
    ["UAT-LEGAL", legal],
    ["UAT-PRODUCT", product],
    ["UAT-OPS", ops],
  ]);
  const gradeByCode = new Map([
    ["UAT-G1", g1],
    ["UAT-G2", g2],
    ["UAT-G3", g3],
    ["UAT-G4", g4],
    ["UAT-G5", g5],
    ["UAT-G6", g6],
  ]);

  // Level 1 (root) + Level 2 — a deliberately WIDE leadership layer:
  // nine positions report directly to the CEO.
  const specs: PositionSpec[] = [
    {
      code: "UAT-CEO",
      title: "Chief Executive Officer",
      deptCode: "UAT-EXEC",
      gradeCode: "UAT-G6",
      managerCode: null,
      location: "New York, NY",
      employee: {
        code: "UAT-EMP-0001",
        firstName: "Solveig",
        lastName: "Bjornstad",
        joiningDate: "2019-01-15",
      },
    },
    {
      code: "UAT-CTO",
      title: "Chief Technology Officer",
      deptCode: "UAT-ENG",
      gradeCode: "UAT-G6",
      managerCode: "UAT-CEO",
      location: "Remote",
      employee: {
        code: "UAT-EMP-0002",
        firstName: "Kenji",
        lastName: "Osei",
        joiningDate: "2019-04-01",
      },
    },
    {
      code: "UAT-VP-SALES",
      title: "VP of Sales",
      deptCode: "UAT-SALES",
      gradeCode: "UAT-G6",
      managerCode: "UAT-CEO",
      location: "Chicago, IL",
      employee: {
        code: "UAT-EMP-0003",
        firstName: "Marisol",
        lastName: "Vance",
        joiningDate: "2019-06-10",
      },
    },
    {
      code: "UAT-VP-MKT",
      title: "VP of Marketing",
      deptCode: "UAT-MKT",
      gradeCode: "UAT-G6",
      managerCode: "UAT-CEO",
      location: "Remote",
      employee: {
        code: "UAT-EMP-0004",
        firstName: "Declan",
        lastName: "Ashworth",
        joiningDate: "2020-01-06",
      },
    },
    {
      code: "UAT-CFO",
      title: "Chief Financial Officer",
      deptCode: "UAT-FIN",
      gradeCode: "UAT-G6",
      managerCode: "UAT-CEO",
      location: "New York, NY",
      employee: {
        code: "UAT-EMP-0005",
        firstName: "Ingrid",
        lastName: "Solberg",
        joiningDate: "2019-09-02",
      },
    },
    // Intentionally VACANT — an approved, active senior leadership
    // position with nobody assigned yet.
    {
      code: "UAT-VP-PEOPLE",
      title: "VP of People & Culture",
      deptCode: "UAT-PEOPLE",
      gradeCode: "UAT-G6",
      managerCode: "UAT-CEO",
      location: "New York, NY",
      employee: null,
    },
    {
      code: "UAT-VP-CS",
      title: "VP of Customer Success",
      deptCode: "UAT-CS",
      gradeCode: "UAT-G6",
      managerCode: "UAT-CEO",
      location: "Manila, Philippines",
      employee: {
        code: "UAT-EMP-0006",
        firstName: "Tomas",
        lastName: "Alvarenga",
        joiningDate: "2020-03-16",
      },
    },
    {
      code: "UAT-GC-LEGAL",
      title: "General Counsel",
      deptCode: "UAT-LEGAL",
      gradeCode: "UAT-G6",
      managerCode: "UAT-CEO",
      location: "London, UK",
      employee: {
        code: "UAT-EMP-0007",
        firstName: "Naledi",
        lastName: "Khumalo",
        joiningDate: "2020-05-11",
      },
    },
    {
      code: "UAT-VP-PRODUCT",
      title: "VP of Product",
      deptCode: "UAT-PRODUCT",
      gradeCode: "UAT-G6",
      managerCode: "UAT-CEO",
      location: "Remote",
      employee: {
        code: "UAT-EMP-0008",
        firstName: "Farid",
        lastName: "Haidari",
        joiningDate: "2020-08-03",
      },
    },
    {
      code: "UAT-VP-OPS",
      title: "VP of Operations",
      deptCode: "UAT-OPS",
      gradeCode: "UAT-G6",
      managerCode: "UAT-CEO",
      location: "Austin, TX",
      employee: {
        code: "UAT-EMP-0009",
        firstName: "Odalys",
        lastName: "Reyes",
        joiningDate: "2021-01-11",
      },
    },

    // Deep branch #1 (Platform Engineering): CEO(1) -> CTO(2) ->
    // Director(3) -> Manager(4) -> Senior Engineer(5) -> Engineer(6) ->
    // Associate Engineer(7) — seven levels deep, comfortably past the
    // "5+ levels" requirement, entirely inside Engineering.
    {
      code: "UAT-DIR-ENG-PLATFORM",
      title: "Director of Platform Engineering",
      deptCode: "UAT-ENG-PLATFORM",
      gradeCode: "UAT-G5",
      managerCode: "UAT-CTO",
      location: "Remote",
      employee: {
        code: "UAT-EMP-0010",
        firstName: "Callum",
        lastName: "Fitzgerald",
        joiningDate: "2020-02-10",
      },
    },
    {
      code: "UAT-ENGMGR-PLATFORM",
      title: "Engineering Manager, Platform",
      deptCode: "UAT-ENG-PLATFORM",
      gradeCode: "UAT-G4",
      managerCode: "UAT-DIR-ENG-PLATFORM",
      location: "Remote",
      employee: {
        code: "UAT-EMP-0011",
        firstName: "Aisha",
        lastName: "Bello",
        joiningDate: "2020-09-14",
      },
    },
    {
      code: "UAT-SR-ENGINEER-PLATFORM",
      title: "Senior Software Engineer",
      deptCode: "UAT-ENG-PLATFORM",
      gradeCode: "UAT-G3",
      managerCode: "UAT-ENGMGR-PLATFORM",
      location: "Remote",
      employee: {
        code: "UAT-EMP-0012",
        firstName: "Dmitri",
        lastName: "Volkov",
        joiningDate: "2021-03-08",
      },
    },
    {
      code: "UAT-ENGINEER-PLATFORM",
      title: "Software Engineer",
      deptCode: "UAT-ENG-PLATFORM",
      gradeCode: "UAT-G2",
      managerCode: "UAT-SR-ENGINEER-PLATFORM",
      location: "Remote",
      employee: {
        code: "UAT-EMP-0013",
        firstName: "Yara",
        lastName: "Haddad",
        joiningDate: "2022-01-17",
      },
    },
    // Intentionally VACANT — deepest level of the chart.
    {
      code: "UAT-ASSOC-ENGINEER-PLATFORM",
      title: "Associate Software Engineer",
      deptCode: "UAT-ENG-PLATFORM",
      gradeCode: "UAT-G1",
      managerCode: "UAT-ENGINEER-PLATFORM",
      location: "Remote",
      employee: null,
    },
    // Left VACANT here — filled and then archived further below, to
    // demonstrate a real employee transfer + position archive.
    {
      code: "UAT-SUPPORT-ENGINEER-LEGACY",
      title: "Legacy Support Engineer",
      deptCode: "UAT-ENG-PLATFORM",
      gradeCode: "UAT-G2",
      managerCode: "UAT-ENGMGR-PLATFORM",
      location: "Remote",
      employee: null,
    },

    // Deep branch #2 (Data Engineering), a sibling under the same CTO.
    {
      code: "UAT-DIR-DATA-ENG",
      title: "Director of Data Engineering",
      deptCode: "UAT-ENG-DATA",
      gradeCode: "UAT-G5",
      managerCode: "UAT-CTO",
      location: "Austin, TX",
      employee: {
        code: "UAT-EMP-0015",
        firstName: "Ingvild",
        lastName: "Haugen",
        joiningDate: "2020-04-20",
      },
    },
    {
      code: "UAT-DATA-ENG-MANAGER",
      title: "Data Engineering Manager",
      deptCode: "UAT-ENG-DATA",
      gradeCode: "UAT-G4",
      managerCode: "UAT-DIR-DATA-ENG",
      location: "Austin, TX",
      employee: {
        code: "UAT-EMP-0016",
        firstName: "Rurik",
        lastName: "Petrenko",
        joiningDate: "2021-05-03",
      },
    },
    {
      code: "UAT-SR-DATA-ENGINEER",
      title: "Senior Data Engineer",
      deptCode: "UAT-ENG-DATA",
      gradeCode: "UAT-G3",
      managerCode: "UAT-DATA-ENG-MANAGER",
      location: "Austin, TX",
      employee: {
        code: "UAT-EMP-0017",
        firstName: "Chidi",
        lastName: "Nwosu",
        joiningDate: "2022-02-14",
      },
    },
    // Left VACANT here — the transfer target for the Legacy Support
    // Engineer scenario further below.
    {
      code: "UAT-ASSOC-DATA-ENGINEER",
      title: "Associate Data Engineer",
      deptCode: "UAT-ENG-DATA",
      gradeCode: "UAT-G2",
      managerCode: "UAT-DATA-ENG-MANAGER",
      location: "Austin, TX",
      employee: null,
    },

    // Sales.
    {
      code: "UAT-SALES-DIR",
      title: "Sales Director",
      deptCode: "UAT-SALES",
      gradeCode: "UAT-G5",
      managerCode: "UAT-VP-SALES",
      location: "Chicago, IL",
      employee: {
        code: "UAT-EMP-0018",
        firstName: "Esteban",
        lastName: "Duarte",
        joiningDate: "2020-07-06",
      },
    },
    {
      code: "UAT-SALES-MGR-EAST",
      title: "Regional Sales Manager, East",
      deptCode: "UAT-SALES",
      gradeCode: "UAT-G4",
      managerCode: "UAT-SALES-DIR",
      location: "New York, NY",
      employee: {
        code: "UAT-EMP-0019",
        firstName: "Mei",
        lastName: "Lin Tanaka",
        joiningDate: "2021-04-12",
      },
    },
    // Intentionally VACANT.
    {
      code: "UAT-SALES-MGR-WEST",
      title: "Regional Sales Manager, West",
      deptCode: "UAT-SALES",
      gradeCode: "UAT-G4",
      managerCode: "UAT-SALES-DIR",
      location: "San Francisco, CA",
      employee: null,
    },
    // Reorganized further below (movePosition) to report directly to
    // UAT-SALES-DIR instead of UAT-SALES-MGR-EAST — the HIERARCHY move
    // demonstration.
    {
      code: "UAT-ACCT-EXEC-1",
      title: "Account Executive",
      deptCode: "UAT-SALES",
      gradeCode: "UAT-G2",
      managerCode: "UAT-SALES-MGR-EAST",
      location: "New York, NY",
      employee: {
        code: "UAT-EMP-0020",
        firstName: "Oskar",
        lastName: "Lindqvist",
        joiningDate: "2022-06-01",
      },
    },

    // Marketing.
    {
      code: "UAT-MKT-MGR",
      title: "Marketing Manager",
      deptCode: "UAT-MKT",
      gradeCode: "UAT-G4",
      managerCode: "UAT-VP-MKT",
      location: "Remote",
      employee: {
        code: "UAT-EMP-0021",
        firstName: "Zainab",
        lastName: "Idris",
        joiningDate: "2021-02-08",
      },
    },
    // Intentionally VACANT.
    {
      code: "UAT-CONTENT-SPECIALIST",
      title: "Content Specialist",
      deptCode: "UAT-MKT",
      gradeCode: "UAT-G2",
      managerCode: "UAT-MKT-MGR",
      location: "Remote",
      employee: null,
    },

    // Finance.
    {
      code: "UAT-FIN-MGR",
      title: "Finance Manager",
      deptCode: "UAT-FIN",
      gradeCode: "UAT-G4",
      managerCode: "UAT-CFO",
      location: "New York, NY",
      employee: {
        code: "UAT-EMP-0022",
        firstName: "Hendrik",
        lastName: "van Dijk",
        joiningDate: "2020-10-19",
      },
    },
    {
      code: "UAT-FIN-ANALYST",
      title: "Financial Analyst",
      deptCode: "UAT-FIN",
      gradeCode: "UAT-G2",
      managerCode: "UAT-FIN-MGR",
      location: "New York, NY",
      employee: {
        code: "UAT-EMP-0023",
        firstName: "Consolata",
        lastName: "Wambui",
        joiningDate: "2022-03-21",
      },
    },

    // People & Culture — reports into the VP position that is itself
    // vacant, demonstrating that hierarchy is between positions, not
    // people.
    {
      code: "UAT-HRBP",
      title: "HR Business Partner",
      deptCode: "UAT-PEOPLE",
      gradeCode: "UAT-G4",
      managerCode: "UAT-VP-PEOPLE",
      location: "New York, NY",
      employee: {
        code: "UAT-EMP-0024",
        firstName: "Freya",
        lastName: "Nystrom",
        joiningDate: "2021-08-16",
      },
    },
    // Intentionally VACANT.
    {
      code: "UAT-HR-COORD",
      title: "HR Coordinator",
      deptCode: "UAT-PEOPLE",
      gradeCode: "UAT-G1",
      managerCode: "UAT-HRBP",
      location: "New York, NY",
      employee: null,
    },

    // Customer Success.
    {
      code: "UAT-CS-MGR",
      title: "Customer Success Manager",
      deptCode: "UAT-CS",
      gradeCode: "UAT-G4",
      managerCode: "UAT-VP-CS",
      location: "Manila, Philippines",
      employee: {
        code: "UAT-EMP-0025",
        firstName: "Rafael",
        lastName: "Nakamura",
        joiningDate: "2021-06-07",
      },
    },
    {
      code: "UAT-CS-REP-1",
      title: "Customer Success Representative",
      deptCode: "UAT-CS",
      gradeCode: "UAT-G2",
      managerCode: "UAT-CS-MGR",
      location: "Manila, Philippines",
      employee: {
        code: "UAT-EMP-0026",
        firstName: "Anezka",
        lastName: "Novakova",
        joiningDate: "2022-05-02",
      },
    },
    // Filled, then TERMINATED further below — demonstrates a position
    // reverting to Vacant because its employee left, not because
    // anything about the position changed.
    {
      code: "UAT-CS-REP-2",
      title: "Customer Success Representative",
      deptCode: "UAT-CS",
      gradeCode: "UAT-G2",
      managerCode: "UAT-CS-MGR",
      location: "Manila, Philippines",
      employee: null,
    },

    // Legal.
    {
      code: "UAT-LEGAL-MGR",
      title: "Compliance Manager",
      deptCode: "UAT-LEGAL",
      gradeCode: "UAT-G4",
      managerCode: "UAT-GC-LEGAL",
      location: "London, UK",
      employee: {
        code: "UAT-EMP-0028",
        firstName: "Suriya",
        lastName: "Chatterjee",
        joiningDate: "2021-09-13",
      },
    },

    // Product.
    {
      code: "UAT-PRODUCT-MGR",
      title: "Product Manager",
      deptCode: "UAT-PRODUCT",
      gradeCode: "UAT-G4",
      managerCode: "UAT-VP-PRODUCT",
      location: "Remote",
      employee: {
        code: "UAT-EMP-0029",
        firstName: "Beatriz",
        lastName: "Salgado",
        joiningDate: "2021-11-01",
      },
    },

    // Operations.
    {
      code: "UAT-OPS-MGR",
      title: "Operations Manager",
      deptCode: "UAT-OPS",
      gradeCode: "UAT-G4",
      managerCode: "UAT-VP-OPS",
      location: "Austin, TX",
      employee: {
        code: "UAT-EMP-0030",
        firstName: "Nadia",
        lastName: "Kowalska",
        joiningDate: "2021-12-06",
      },
    },
  ];

  const positionByCode = new Map<string, { id: string; organizationalLevel: number }>();
  for (const spec of specs) {
    const dept = deptByCode.get(spec.deptCode);
    if (!dept) throw new Error(`Unknown UAT department code in seed data: ${spec.deptCode}`);
    const grade = spec.gradeCode ? (gradeByCode.get(spec.gradeCode) ?? null) : null;
    const manager = spec.managerCode ? (positionByCode.get(spec.managerCode) ?? null) : null;
    if (spec.managerCode && !manager) {
      throw new Error(
        `UAT seed data lists ${spec.code}'s manager (${spec.managerCode}) before it is created — ` +
          "position specs must be ordered manager-before-subordinate."
      );
    }

    const position = await getOrCreatePosition(spec.code, {
      title: spec.title,
      departmentId: dept.id,
      jobGradeId: grade?.id ?? null,
      managerId: manager?.id ?? null,
      location: spec.location ?? null,
    });
    positionByCode.set(spec.code, position);

    if (spec.employee) {
      const employee = await getOrCreateEmployee(spec.employee.code, {
        firstName: spec.employee.firstName,
        lastName: spec.employee.lastName,
        workEmail: `${spec.employee.firstName.toLowerCase().replace(/[^a-z]/g, "")}.${spec.employee.lastName
          .toLowerCase()
          .replace(/[^a-z]/g, "")}@${emailDomain}`,
        joiningDate: new Date(spec.employee.joiningDate),
      });
      await getOrCreateAssignment(employee.id, position.id, new Date(spec.employee.joiningDate));
    }
  }

  // -----------------------------------------------------------------
  // Two PLANNED positions (approved for a future hire, not yet
  // active) — see getOrCreatePlannedPosition's own comment for why
  // these bypass the service layer.
  // -----------------------------------------------------------------

  await getOrCreatePlannedPosition("UAT-DATA-ENGINEER", {
    title: "Data Engineer",
    departmentId: engData.id,
    jobGradeId: g2.id,
    managerId: positionByCode.get("UAT-DATA-ENG-MANAGER")!.id,
    location: "Austin, TX",
  });
  await getOrCreatePlannedPosition("UAT-ASSOC-PRODUCT-MGR", {
    title: "Associate Product Manager",
    departmentId: product.id,
    jobGradeId: g1.id,
    managerId: positionByCode.get("UAT-PRODUCT-MGR")!.id,
    location: "Remote",
  });

  // -----------------------------------------------------------------
  // An employee with NO current (or ever) position assignment — a
  // real-world "hired, not yet placed" scenario.
  // -----------------------------------------------------------------

  await getOrCreateEmployee("UAT-EMP-0031", {
    firstName: "Wanjiru",
    lastName: "Kariuki",
    workEmail: `wanjiru.kariuki@${emailDomain}`,
    joiningDate: new Date("2025-08-04"),
  });

  // -----------------------------------------------------------------
  // An employee with a PAST (ended) assignment plus a current one —
  // Bjorn starts as the Legacy Support Engineer, is transferred to the
  // (previously vacant) Associate Data Engineer position, and the
  // now-vacated Legacy Support Engineer position is archived — all via
  // the real transferEmployee/archivePosition service functions, each
  // individually guarded so re-running this script never repeats them.
  // -----------------------------------------------------------------

  const legacySupportPosition = positionByCode.get("UAT-SUPPORT-ENGINEER-LEGACY")!;
  const assocDataEngineerPosition = positionByCode.get("UAT-ASSOC-DATA-ENGINEER")!;

  const bjorn = await getOrCreateEmployee("UAT-EMP-0032", {
    firstName: "Bjorn",
    lastName: "Eide",
    workEmail: `bjorn.eide@${emailDomain}`,
    joiningDate: new Date("2020-11-02"),
  });
  await getOrCreateAssignment(bjorn.id, legacySupportPosition.id, new Date("2020-11-02"));

  const bjornOpenOnLegacy = await db.positionAssignment.findFirst({
    where: {
      companyId: company.id,
      employeeId: bjorn.id,
      positionId: legacySupportPosition.id,
      endDate: null,
    },
  });
  if (bjornOpenOnLegacy) {
    await transferEmployee(
      {
        companyId: company.id,
        actor: editorActor,
        employeeId: bjorn.id,
        fromAssignmentId: bjornOpenOnLegacy.id,
        toPositionId: assocDataEngineerPosition.id,
        transferDate: new Date("2023-06-01"),
      },
      db
    );
  }

  const currentLegacyPosition = await db.position.findUnique({
    where: { id: legacySupportPosition.id },
  });
  if (currentLegacyPosition && currentLegacyPosition.status !== "INACTIVE") {
    await archivePosition(legacySupportPosition.id, company.id, editorActor, db);
  }

  // -----------------------------------------------------------------
  // A terminated employee — Jonas is assigned, then terminated, so his
  // position (UAT-CS-REP-2) reverts to Vacant without itself changing.
  // -----------------------------------------------------------------

  const csRep2Position = positionByCode.get("UAT-CS-REP-2")!;
  const jonas = await getOrCreateEmployee("UAT-EMP-0027", {
    firstName: "Jonas",
    lastName: "Eklund",
    workEmail: `jonas.eklund@${emailDomain}`,
    joiningDate: new Date("2022-08-01"),
  });
  await getOrCreateAssignment(jonas.id, csRep2Position.id, new Date("2022-08-01"));

  const currentJonas = await db.employee.findUnique({ where: { id: jonas.id } });
  if (currentJonas && currentJonas.employmentStatus !== "TERMINATED") {
    await terminateEmployee(
      {
        companyId: company.id,
        actor: editorActor,
        employeeId: jonas.id,
        terminationDate: new Date("2024-11-15"),
      },
      db
    );
  }

  // -----------------------------------------------------------------
  // A hierarchy move (HIERARCHY-category audit event) — Account
  // Executive 1 is reorganized to report straight to the Sales
  // Director instead of the Regional Sales Manager, East.
  // -----------------------------------------------------------------

  const acctExec1 = positionByCode.get("UAT-ACCT-EXEC-1")!;
  const salesDirector = positionByCode.get("UAT-SALES-DIR")!;
  const currentAcctExec1 = await db.position.findUnique({ where: { id: acctExec1.id } });
  if (currentAcctExec1 && currentAcctExec1.primaryReportsToPositionId !== salesDirector.id) {
    await movePosition(
      {
        companyId: company.id,
        actor: editorActor,
        positionId: acctExec1.id,
        newParentPositionId: salesDirector.id,
      },
      db
    );
  }

  return {
    company,
    users: { adminUser, editorUser },
    positionCount: positionByCode.size + 2, // + the two PLANNED positions
  };
}

/* c8 ignore start -- CLI entry point, exercised manually and via `npm run db:seed:uat`, not under unit/integration coverage */
async function runAsCli() {
  assertUatSeedAllowed();
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  try {
    const result = await runUatSeed(db);
    console.log(
      `UAT seed complete for company "${result.company.name}" (${result.company.code}). ` +
        `~${result.positionCount} positions. Demo users: ${result.users.adminUser.email} (ADMIN), ` +
        `${result.users.editorUser.email} (HR_EDITOR).`
    );
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  runAsCli().catch((error: unknown) => {
    console.error("UAT seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
/* c8 ignore stop */
