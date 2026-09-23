/**
 * One-off local convenience: rebuild the DEV-LOCAL company in the LOCAL dev
 * database to mirror what currently exists on staging, so `localhost:3000`
 * shows the same org the staging site does. NOT committed / not part of the
 * app — a throwaway snapshot. Run with:
 *   NODE_ENV=development npx tsx scripts/seed-dev-local-from-staging.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const COMPANY_CODE = "DEV-LOCAL";

// The standard L2–L18 scale (same values the app's provisionStandardLevels uses).
const SCALE: { code: string; level: number; name: string }[] = [
  { code: "L2", level: 2, name: "Trainee / Associate" },
  { code: "L3", level: 3, name: "Junior" },
  { code: "L4", level: 4, name: "Mid Level" },
  { code: "L5", level: 5, name: "Mid Level II" },
  { code: "L6", level: 6, name: "Senior" },
  { code: "L7", level: 7, name: "Lead / Principal" },
  { code: "L8", level: 8, name: "Senior Lead / Principal II" },
  { code: "L9", level: 9, name: "Associate Manager / Associate Architect" },
  { code: "L10", level: 10, name: "Manager / Architect" },
  { code: "L11", level: 11, name: "Associate Director" },
  { code: "L12", level: 12, name: "Director" },
  { code: "L13", level: 13, name: "Senior Director" },
  { code: "L14", level: 14, name: "Associate VP" },
  { code: "L15", level: 15, name: "VP" },
  { code: "L16", level: 16, name: "Senior VP" },
  { code: "L17", level: 17, name: "Senior Executive VP" },
  { code: "L18", level: 18, name: "C Suite" },
];

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run against production.");
  }

  const company = await prisma.company.upsert({
    where: { code: COMPANY_CODE },
    update: {},
    create: { name: "Local Dev Company", code: COMPANY_CODE },
  });
  const companyId = company.id;

  // Clean slate for this company's org data so re-runs stay idempotent.
  await prisma.positionAssignment.deleteMany({ where: { companyId } });
  await prisma.position.deleteMany({ where: { companyId } });
  await prisma.levelMappingEntry.deleteMany({ where: { companyId } });
  await prisma.careerTrack.deleteMany({ where: { companyId } });
  await prisma.jobFamily.deleteMany({ where: { companyId } });
  await prisma.jobGrade.deleteMany({ where: { companyId } });
  await prisma.department.deleteMany({ where: { companyId } });

  // Departments
  async function dept(code: string, name: string, order: number, color: string | null) {
    return prisma.department.create({
      data: { companyId, code, name, displayOrder: order, color, status: "ACTIVE" },
    });
  }
  const founder = await dept("FOUNDER", "Founder", 1, "#a855f7");
  const engineering = await dept("ENG", "Engineering", 2, "#16a34a");
  await dept("FIN", "Finance", 3, "#6366f1");
  await dept("MKT", "Marketing", 4, "#f97316");

  // Company-wide levels L2–L18
  const gradeByCode = new Map<string, string>();
  for (const g of SCALE) {
    const created = await prisma.jobGrade.create({
      data: {
        companyId,
        departmentId: null,
        code: g.code,
        name: g.name,
        displayOrder: g.level,
        status: "ACTIVE",
      },
    });
    gradeByCode.set(g.code, created.id);
  }

  // Job families (Engineering)
  async function family(code: string, name: string, order: number) {
    return prisma.jobFamily.create({
      data: {
        companyId,
        departmentId: engineering.id,
        code,
        name,
        displayOrder: order,
        status: "ACTIVE",
      },
    });
  }
  const devops = await family("DEVOPS", "DevOps", 1);
  const qa = await family("QA", "QA / QAA", 2);
  const uiux = await family("UIUX", "UI/UX", 3);
  void devops; // present in the framework; no positions reference it (matches staging)

  // Positions — reporting chain + families + the one graded role (Manager UI/UX = L6),
  // mirroring staging. organizationalLevel is depth (root = 1).
  let seq = 0;
  const code = () => `POS-${(++seq).toString().padStart(3, "0")}`;
  async function pos(args: {
    title: string;
    departmentId: string;
    level: number;
    reportsTo: string | null;
    jobFamilyId?: string | null;
    jobGradeCode?: string | null;
  }) {
    return prisma.position.create({
      data: {
        companyId,
        positionCode: code(),
        title: args.title,
        departmentId: args.departmentId,
        organizationalLevel: args.level,
        primaryReportsToPositionId: args.reportsTo,
        jobFamilyId: args.jobFamilyId ?? null,
        jobGradeId: args.jobGradeCode ? (gradeByCode.get(args.jobGradeCode) ?? null) : null,
        status: "ACTIVE",
      },
    });
  }

  const ceo = await pos({ title: "CEO", departmentId: founder.id, level: 1, reportsTo: null });
  const cto = await pos({
    title: "CTO",
    departmentId: engineering.id,
    level: 2,
    reportsTo: ceo.id,
  });
  const vp = await pos({
    title: "VP of Engineering",
    departmentId: engineering.id,
    level: 3,
    reportsTo: cto.id,
  });
  const dir = await pos({
    title: "Director of Engineering",
    departmentId: engineering.id,
    level: 4,
    reportsTo: vp.id,
  });
  const asst = await pos({
    title: "Assistant Director",
    departmentId: engineering.id,
    level: 5,
    reportsTo: dir.id,
  });
  const adQa = await pos({
    title: "Associate Director",
    departmentId: engineering.id,
    level: 6,
    reportsTo: asst.id,
    jobFamilyId: qa.id,
  });
  const adUi = await pos({
    title: "Associate Director",
    departmentId: engineering.id,
    level: 6,
    reportsTo: asst.id,
    jobFamilyId: uiux.id,
  });
  await pos({
    title: "Architect UI/UX",
    departmentId: engineering.id,
    level: 7,
    reportsTo: adUi.id,
    jobFamilyId: uiux.id,
  });
  await pos({
    title: "Manager UI/UX",
    departmentId: engineering.id,
    level: 7,
    reportsTo: adQa.id,
    jobGradeCode: "L6",
  });
  await pos({
    title: "QA Architect",
    departmentId: engineering.id,
    level: 7,
    reportsTo: adQa.id,
    jobFamilyId: qa.id,
  });
  await pos({ title: "QA Manager", departmentId: engineering.id, level: 7, reportsTo: adQa.id });

  const count = await prisma.position.count({ where: { companyId } });
  console.log(
    `DEV-LOCAL rebuilt: ${count} positions, 4 departments, ${SCALE.length} levels, 3 families.`
  );
}

main()
  .catch((e) => {
    console.error("seed-dev-local-from-staging failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
