/**
 * One-off data script (docs/HANDOFF.md): builds the Engineering branch from
 * the user's chart (2026-10-02).
 *
 *   CEO → CTO (Mohsin Kalam) → VP of Engineering → Director Of Engineering
 *       → Asst. Director Of Engineering → five Associate Directors, each over
 *         one or two sub-divisions (QA / QAA, UI/UX, DevOps, Backend + DE,
 *         Mobile).
 *
 * Every sub-division has two lines (an IC/architect line and a manager/lead
 * line). The two lines MEET at the first "Sr. … Engineer" role, which
 * reports to the last role of each line (two heads, D27). Below that it is
 * one chain.
 *
 * User decisions: a box listing several people becomes ONE vacant position
 * (people are assigned later in the app); levels are left empty. A box with
 * one name is seated if that employee exists on staging and is not already
 * seated elsewhere.
 *
 * Goes through the app's own services, so every write is validated and
 * audit-logged like the UI. Idempotent: each position gets a fixed code
 * derived from its place in the chart, so a re-run reuses what exists (many
 * titles repeat, e.g. five "Associate Director" boxes). The Engineering
 * department is reactivated if it is inactive. DRY RUN by default; APPLY=1
 * writes.
 *
 *   npx dotenv -e .env.staging.local -- npx tsx --conditions=react-server scripts/add-engineering-org.ts
 *   APPLY=1 npx dotenv -e .env.staging.local -- npx tsx --conditions=react-server scripts/add-engineering-org.ts
 */
import { createHash } from "node:crypto";

import { PrismaClient } from "@prisma/client";

import { runtimeDatabaseUrl } from "@/lib/db/runtime-database-url";
import { createAssignment } from "@/lib/services/assignment.service";
import { createJobFamily } from "@/lib/services/career-framework.service";
import { reactivateDepartment } from "@/lib/services/department.service";
import { createPosition } from "@/lib/services/hierarchy.service";

/** A box: its title and, when exactly one person is named on it, that person. */
type Box = [title: string, person?: string];

interface SubDivision {
  name: string;
  code: string;
  /** The IC / architect line, top to bottom. */
  left: Box[];
  /** The manager / lead line, top to bottom. */
  right: Box[];
  /** From the role where both lines meet, top to bottom. */
  merged: Box[];
}

interface AssociateDirector {
  person?: string;
  subDivisions: SubDivision[];
}

const TOP: Box[] = [
  ["CTO", "Mohsin Kalam"],
  ["VP of Engineering"],
  ["Director Of Engineering"],
  ["Asst. Director Of Engineering"],
];

const softwareLines = (managerPerson?: string): Pick<SubDivision, "left" | "right"> => ({
  left: [
    ["Architect"],
    ["Associate Architect"],
    ["Principal Software Engineer II"],
    ["Principal Software Engineer"],
    ["Sr. Software Engineer II"],
  ],
  right: [
    ["Manager", managerPerson],
    ["Associate Manager"],
    ["Sr. Tech Lead"],
    ["Tech Lead"],
    ["Associate Tech Lead"],
  ],
});

const softwareChain: Box[] = [
  ["Sr. Software Engineer"],
  ["Software Engineer II"],
  ["Software Engineer"],
  ["Associate Software Engineer"],
];

const ASSOCIATE_DIRECTORS: AssociateDirector[] = [
  {
    subDivisions: [
      {
        name: "QA / QAA",
        code: "QA",
        left: [
          ["QA Architect"],
          ["Associate QA Architect"],
          ["Principal QA Engineer II"],
          ["Principal QA Engineer"],
          ["Sr. QA Engineer II"],
        ],
        right: [
          ["QA Manager"],
          ["Associate QA Manager"],
          ["Sr. QA Lead"],
          ["QA Lead"],
          ["Associate QA Lead"],
        ],
        merged: [
          ["Sr. QA Engineer"],
          ["QA Engineer II"],
          ["QA Engineer"],
          ["Associate QA Engineer"],
        ],
      },
    ],
  },
  {
    person: "Asadullah Sharif",
    subDivisions: [
      {
        name: "UI/UX",
        code: "UIUX",
        left: [
          ["Architect UI/UX"],
          ["Associate Architect"],
          ["Principal UI/UX II", "Hussain Shabbir"],
          ["Principal UI/UX", "Maroof Ali"],
          ["Sr. UI/UX Engineer II"],
        ],
        right: [
          ["Manager UI/UX"],
          ["Associate Manager"],
          ["Sr. Lead UI/UX"],
          ["Tech Lead UI/UX"],
          ["Associate Lead UI/UX"],
        ],
        merged: [
          ["Sr. UI/UX Engineer"],
          ["UI/UX Engineer II"],
          ["UI/UX Engineer"],
          ["Associate UI/UX Engineer"],
        ],
      },
    ],
  },
  {
    subDivisions: [
      {
        name: "DevOps",
        code: "DEVOPS",
        left: [
          ["DevOps Architect"],
          ["Associate DevOps Architect"],
          ["DevOps - Principal Engineer II"],
          ["DevOps - Principal Engineer"],
          ["Sr. DevOps Engineer II"],
        ],
        right: [
          ["Manager DevOps"],
          ["Associate Manager DevOps"],
          ["Sr. Lead DevOps"],
          ["Lead DevOps", "Sharjeel Abedin"],
          ["Associate Lead DevOps"],
        ],
        merged: [
          ["Sr. DevOps Engineer"],
          ["DevOps Engineer II"],
          ["DevOps Engineer"],
          ["Associate DevOps Engineer"],
        ],
      },
    ],
  },
  {
    person: "Miesam Ali",
    subDivisions: [
      {
        name: "Backend", // the chart labels it "Backend (MERN, LAMP, AI/ML, DS, Python, Full Stack)"; it already exists as "Backend"
        code: "BACKEND",
        left: [
          ["Architect", "Saleem Khan"],
          ["Associate Architect", "M. Aqeeb"],
          ["Principal Software Engineer II"], // M. Fawad, Irfan Mumtaz — shared box, vacant
          ["Principal Software Engineer"], // five people — shared box, vacant
          ["Sr. Software Engineer II"],
        ],
        right: [
          ["Manager"],
          ["Associate Manager", "Zafar Shah"],
          ["Sr. Tech Lead", "Muneeb Ahmed Khan"],
          ["Tech Lead"], // Maha Dev, Affan Younus — shared box, vacant
          ["Associate Tech Lead"],
        ],
        merged: softwareChain,
      },
      {
        name: "DE",
        code: "DE",
        ...softwareLines(),
        merged: [
          ["Sr. Data Engineer"],
          ["Data Engineer II"],
          ["Data Engineer"],
          ["Associate Data Engineer"],
        ],
      },
    ],
  },
  {
    subDivisions: [
      { name: "Mobile", code: "MOBILE", ...softwareLines("Nadeem Iqbal"), merged: softwareChain },
    ],
  },
];

/** Shared boxes left vacant on purpose, for the summary. */
const SHARED_BOXES = [
  "Backend · Principal Software Engineer II (M. Fawad, Irfan Mumtaz)",
  "Backend · Principal Software Engineer (Ghulam Nabi, Waqas Ansari, Zeeshan Rasheed, Owais Hassan Zaidi, Haris Ali)",
  "Backend · Tech Lead (Maha Dev, Affan Younus)",
];

const apply = process.env.APPLY === "1";

// Its own client with generous transaction limits: from a laptop each round
// trip to the staging database can take seconds (docs/HANDOFF.md).
const prisma = new PrismaClient({
  datasourceUrl: runtimeDatabaseUrl(process.env.DATABASE_URL).url,
  transactionOptions: { maxWait: 30_000, timeout: 120_000 },
});

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
/** A fixed, unique code for a box from its place in the chart. */
const codeFor = (path: string) =>
  `ENG-${createHash("sha1").update(path).digest("hex").slice(0, 8).toUpperCase()}`;

let created = 0;
let reused = 0;
const notes: string[] = [];

async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Refusing to run with NODE_ENV=production.");
  console.log(apply ? "APPLYING changes" : "DRY RUN (set APPLY=1 to write)");

  // The company that also has Delivery Org / Administration (DOA): the same
  // org chart as scripts/add-delivery-org-subdivisions.ts.
  const doaCompanies = (await prisma.department.findMany({ where: { code: "DOA" } })).map(
    (d) => d.companyId
  );
  const candidates = await prisma.department.findMany({
    where: {
      name: { equals: "Engineering", mode: "insensitive" },
      companyId: { in: doaCompanies },
    },
  });
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one "Engineering" department, found ${candidates.length}.`);
  }
  const department = candidates[0]!;
  const companyId = department.companyId;
  if (department.status !== "ACTIVE") {
    console.log(`Department "${department.name}" is ${department.status} — reactivate`);
    if (apply) await reactivateDepartment(department.id, companyId, "SYSTEM", prisma);
  } else {
    console.log(`Department "${department.name}" is active`);
  }

  const root = await prisma.position.findFirst({
    where: { companyId, primaryReportsToPositionId: null },
  });
  if (!root) throw new Error("The company has no root position; nothing created.");

  const employees = await prisma.employee.findMany({
    where: { companyId },
    include: { assignments: { where: { endDate: null }, include: { position: true } } },
  });
  const takenFamilyCodes = new Set(
    (await prisma.jobFamily.findMany({ where: { companyId }, select: { code: true } })).map(
      (f) => f.code
    )
  );

  /** Finds or creates one position; returns its id (a placeholder in a dry run). */
  async function ensurePosition(
    path: string,
    box: Box,
    heads: { primary: string; co?: string },
    jobFamilyId: string | null,
    indent: string
  ): Promise<string> {
    const [title, person] = box;
    const positionCode = codeFor(path);
    const existing = await prisma.position.findFirst({ where: { companyId, positionCode } });
    let id: string;
    if (existing) {
      reused++;
      id = existing.id;
      console.log(`${indent}${title} — exists, reused`);
    } else {
      created++;
      console.log(`${indent}${title} — create${heads.co ? " (two heads)" : ""}`);
      if (apply) {
        const position = await createPosition(
          {
            companyId,
            actor: "SYSTEM",
            departmentId: department.id,
            jobFamilyId,
            title,
            positionCode,
            primaryReportsToPositionId: heads.primary,
            coReportsToPositionId: heads.co ?? null,
          },
          prisma
        );
        id = position.id;
      } else {
        id = `dry:${positionCode}`;
      }
    }
    if (person) await seat(person, id, `${indent}  `, title);
    return id;
  }

  async function seat(person: string, positionId: string, indent: string, title: string) {
    const wanted = norm(person).split(" ");
    const matches = employees.filter((e) => {
      const full = norm(`${e.firstName} ${e.lastName}`).split(" ");
      if (full.length !== wanted.length) return false;
      // "M. Aeeb" matches "Muhammad Aeeb": an initial matches any name with that letter.
      return wanted.every((w, i) =>
        w.endsWith(".") ? full[i]!.startsWith(w.slice(0, -1)) : full[i] === w
      );
    });
    if (matches.length !== 1) {
      const why =
        matches.length === 0 ? "no employee with this name" : `${matches.length} employees match`;
      console.log(`${indent}! ${person}: ${why} — left vacant`);
      notes.push(`${title}: ${person} — ${why}; left vacant`);
      return;
    }
    const employee = matches[0]!;
    if (employee.assignments.some((a) => a.positionId === positionId)) {
      console.log(`${indent}${person} already in this seat`);
      return;
    }
    if (employee.assignments.length > 0) {
      const where = employee.assignments[0]!.position.title;
      console.log(`${indent}! ${person} already sits in "${where}" — not moved, left vacant`);
      notes.push(`${title}: ${person} already sits in "${where}"; not moved`);
      return;
    }
    console.log(`${indent}assign ${person}`);
    if (apply && !positionId.startsWith("dry:")) {
      await createAssignment(
        { companyId, actor: "SYSTEM", employeeId: employee.id, positionId, startDate: new Date() },
        prisma
      );
    }
  }

  async function ensureSubDivision(sub: SubDivision): Promise<string | null> {
    const existing = await prisma.jobFamily.findFirst({
      where: {
        companyId,
        departmentId: department.id,
        name: { equals: sub.name, mode: "insensitive" },
      },
    });
    if (existing) {
      console.log(`  Sub-division "${existing.name}" — exists, reused`);
      return existing.id;
    }
    const code = takenFamilyCodes.has(sub.code) ? `ENG-${sub.code}` : sub.code;
    console.log(`  Sub-division "${sub.name}" (${code}) — create`);
    if (!apply) return null;
    takenFamilyCodes.add(code);
    const family = await createJobFamily(
      { companyId, actor: "SYSTEM", departmentId: department.id, name: sub.name, code },
      prisma
    );
    return family.id;
  }

  // The top of the branch, under the company root.
  let parent = root.id;
  let path = "eng";
  for (const box of TOP) {
    path = `${path}/${box[0]}`;
    parent = await ensurePosition(path, box, { primary: parent }, null, "");
  }
  const topId = parent;

  for (const [index, ad] of ASSOCIATE_DIRECTORS.entries()) {
    const adPath = `${path}/Associate Director#${index + 1}`;
    console.log("");
    const adId = await ensurePosition(
      adPath,
      ["Associate Director", ad.person],
      { primary: topId },
      null,
      ""
    );
    for (const sub of ad.subDivisions) {
      const familyId = await ensureSubDivision(sub);
      const subPath = `${adPath}/${sub.code}`;
      const ends: string[] = [];
      for (const [side, line] of [
        ["left", sub.left],
        ["right", sub.right],
      ] as const) {
        let manager = adId;
        for (const box of line) {
          manager = await ensurePosition(
            `${subPath}/${side}/${box[0]}`,
            box,
            { primary: manager },
            familyId,
            "    "
          );
        }
        ends.push(manager);
      }
      // Both lines meet here: the first merged role reports to the end of each.
      let manager: string | undefined;
      for (const [i, box] of sub.merged.entries()) {
        const heads = i === 0 ? { primary: ends[0]!, co: ends[1]! } : { primary: manager! };
        manager = await ensurePosition(`${subPath}/merged/${box[0]}`, box, heads, familyId, "    ");
      }
    }
  }

  console.log(`\n${created} position(s) to create, ${reused} already there.`);
  console.log("Shared boxes left vacant by choice:");
  for (const s of SHARED_BOXES) console.log(`  - ${s}`);
  if (notes.length > 0) {
    console.log("Needs a look:");
    for (const n of notes) console.log(`  - ${n}`);
  }
  console.log(apply ? "Done." : "Dry run only — nothing written.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
