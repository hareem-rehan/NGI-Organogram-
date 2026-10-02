/**
 * One-off data script (kept for the handoff, docs/HANDOFF.md): builds the Delivery Org /
 * Administration branch from the user's chart (2026-10-02):
 *
 *   COO (created under the CEO if missing)
 *   ├─ [Admin] Head of Admin → Associate Head of Admin → Sr. Manager Admin
 *   │          → Manager Admin (Hammad Hussain) → Associate Manager Admin
 *   │          (Junaid Hassan) → Sr. Admin Officer → Admin Officer
 *   └─ [IT]    Head of IT → Associate Head of IT & Ops → Sr. Manager IT & Ops
 *              → Manager IT (Rana Faraz) → Associate Manager IT
 *              → Sr. IT Officer (Faraz Khurram) → IT Officer
 *
 * Goes through the app's own services, so every write is validated and
 * audit-logged exactly like the UI. Idempotent: existing sub-divisions and
 * same-titled positions in the department are reused, never duplicated.
 * DRY RUN by default; APPLY=1 writes.
 *
 *   npx dotenv -e <env file> -- npx tsx --conditions=react-server \
 *     scripts/add-delivery-org-subdivisions.ts            # dry run
 *   APPLY=1 npx dotenv -e <env file> -- npx tsx --conditions=react-server \
 *     scripts/add-delivery-org-subdivisions.ts            # write
 */
import { randomBytes } from "node:crypto";

import { prisma } from "@/lib/db/prisma";
import { createAssignment } from "@/lib/services/assignment.service";
import { createJobFamily } from "@/lib/services/career-framework.service";
import { createPosition } from "@/lib/services/hierarchy.service";

const DEPARTMENT_CODE = "DOA";
const HEAD_TITLE = "COO";

const BRANCHES: { subDivision: string; code: string; chain: [string, string?][] }[] = [
  {
    subDivision: "Admin",
    code: "ADMIN",
    chain: [
      ["Head of Admin"],
      ["Associate Head of Admin"],
      ["Sr. Manager Admin"],
      ["Manager Admin", "Hammad Hussain"],
      ["Associate Manager Admin", "Junaid Hassan"],
      ["Sr. Admin Officer"],
      ["Admin Officer"],
    ],
  },
  {
    subDivision: "IT",
    code: "IT",
    chain: [
      ["Head of IT"],
      ["Associate Head of IT & Ops"],
      ["Sr. Manager IT & Ops"],
      ["Manager IT", "Rana Faraz"],
      ["Associate Manager IT"],
      ["Sr. IT Officer", "Faraz Khurram"],
      ["IT Officer"],
    ],
  },
];

const apply = process.env.APPLY === "1";
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Refusing to run with NODE_ENV=production.");
  console.log(apply ? "APPLYING changes" : "DRY RUN (set APPLY=1 to write)");

  const departments = await prisma.department.findMany({ where: { code: DEPARTMENT_CODE } });
  if (departments.length !== 1) {
    throw new Error(
      `Expected exactly one ${DEPARTMENT_CODE} department, found ${departments.length}.`
    );
  }
  const department = departments[0]!;
  const companyId = department.companyId;
  console.log(`Department: ${department.name}`);

  const inDepartment = await prisma.position.findMany({
    where: { companyId, departmentId: department.id },
  });
  const byTitle = new Map(inDepartment.map((p) => [norm(p.title), p]));
  // The COO heads the department, reporting to the company's root (CEO).
  let head = byTitle.get(norm(HEAD_TITLE));
  if (head) {
    console.log(`Head: ${head.title} (${head.positionCode}) — exists, reused`);
  } else {
    const root = await prisma.position.findFirst({
      where: { companyId, primaryReportsToPositionId: null },
    });
    if (!root) throw new Error("The company has no root position; nothing created.");
    console.log(`Head: ${HEAD_TITLE} — create (reports to ${root.title})`);
    head = apply
      ? await createPosition({
          companyId,
          actor: "SYSTEM",
          departmentId: department.id,
          title: HEAD_TITLE,
          positionCode: `POS-${randomBytes(4).toString("hex").toUpperCase().slice(0, 6)}`,
          primaryReportsToPositionId: root.id,
        })
      : ({ ...root, id: "dry-COO", title: HEAD_TITLE } as typeof root);
  }

  const takenFamilyCodes = new Set(
    (await prisma.jobFamily.findMany({ where: { companyId }, select: { code: true } })).map(
      (f) => f.code
    )
  );
  const employees = await prisma.employee.findMany({
    where: { companyId },
    include: { assignments: { where: { endDate: null }, include: { position: true } } },
  });

  for (const branch of BRANCHES) {
    // Sub-division: reuse one of the same name in this department.
    let family = await prisma.jobFamily.findFirst({
      where: {
        companyId,
        departmentId: department.id,
        name: { equals: branch.subDivision, mode: "insensitive" },
      },
    });
    if (family) {
      console.log(`\nSub-division "${family.name}" exists — reused`);
    } else {
      const code = takenFamilyCodes.has(branch.code)
        ? `${DEPARTMENT_CODE}-${branch.code}`
        : branch.code;
      console.log(`\nSub-division "${branch.subDivision}" (${code}) — create`);
      if (apply) {
        family = await createJobFamily({
          companyId,
          departmentId: department.id,
          name: branch.subDivision,
          code,
          actor: "SYSTEM",
        });
      }
    }

    let managerId: string = head!.id;
    for (const [title, occupant] of branch.chain) {
      const existing = byTitle.get(norm(title));
      let positionId: string;
      if (existing) {
        console.log(`  ${title} — exists, reused`);
        positionId = existing.id;
      } else {
        console.log(
          `  ${title} — create (reports to ${managerId === head!.id ? head!.title : "previous"})`
        );
        if (!apply) {
          positionId = `dry-${title}`;
        } else {
          const created = await createPosition({
            companyId,
            actor: "SYSTEM",
            departmentId: department.id,
            jobFamilyId: family!.id,
            title,
            positionCode: `POS-${randomBytes(4).toString("hex").toUpperCase().slice(0, 6)}`,
            primaryReportsToPositionId: managerId,
          });
          positionId = created.id;
          byTitle.set(norm(title), created);
        }
      }

      if (occupant) {
        const person = employees.find(
          (e) => norm(`${e.firstName} ${e.lastName}`) === norm(occupant)
        );
        if (!person) {
          console.log(`    ! ${occupant}: no employee with this name — left vacant`);
        } else if (person.assignments.some((a) => a.positionId === positionId)) {
          console.log(`    ${occupant} already in this seat`);
        } else if (person.assignments.length > 0) {
          console.log(
            `    ! ${occupant} already sits in "${person.assignments[0]!.position.title}" — not moved, left vacant`
          );
        } else {
          console.log(`    assign ${occupant}`);
          if (apply && !positionId.startsWith("dry-")) {
            await createAssignment({
              companyId,
              actor: "SYSTEM",
              employeeId: person.id,
              positionId,
              startDate: new Date(),
            });
          }
        }
      }
      managerId = positionId;
    }
  }
  console.log(apply ? "\nDone." : "\nDry run only — nothing written.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
