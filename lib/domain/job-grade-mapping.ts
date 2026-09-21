/**
 * Career-level scale and title -> level mapping.
 *
 * Transcribed from the company's own "PMF - Levels Info - LevelMapping"
 * document. The scale runs L2..L18 across five tracks (Engineering,
 * Project, Product, HR, IT), each with an IC and a Manager column.
 *
 * WHERE THIS IS AND IS NOT USED
 *
 * `inferGradeLevelFromTitle` exists ONLY to POPULATE job grades for
 * positions that have none — a one-off data-backfill helper, run
 * deliberately, whose output a human can review before it is applied.
 *
 * It is deliberately NOT used when rendering the organogram. The
 * stakeholder was explicit that the leadership threshold "must be based
 * on the employee/position level rather than hardcoding specific job
 * titles", so `organogram-leadership.ts` reads ONLY the stored grade.
 * A position whose title looks senior but whose stored grade is junior
 * stays hidden, and vice versa — the stored grade is always the
 * authority, and a title never overrides it at render time.
 */

/** The full scale, lowest to highest. `level` doubles as the grade's displayOrder. */
export const JOB_GRADE_SCALE: readonly { code: string; level: number; name: string }[] = [
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

export function gradeCodeForLevel(level: number): string | null {
  return JOB_GRADE_SCALE.find((g) => g.level === level)?.code ?? null;
}

/**
 * Normalises a title for matching: lowercase, common abbreviations
 * expanded, punctuation and extra whitespace removed. Keeps the raw title
 * untouched — this is only ever used to compare against the rules below.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bsr\.?\b/g, "senior")
    .replace(/\bjr\.?\b/g, "junior")
    .replace(/\basst\.?\b/g, "assistant")
    .replace(/\bassoc\.?\b/g, "associate")
    .replace(/\bmgr\.?\b/g, "manager")
    .replace(/\bops\.?\b/g, "operations")
    .replace(/\beng\.?\b/g, "engineer")
    .replace(/[./|,()[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface TitleRule {
  /**
   * Every token must appear in the normalised title AS A WHOLE WORD.
   *
   * Whole-word matching is not a detail: a substring check reads "cto"
   * inside "dire-cto-r" and silently promotes every Director to C-suite.
   * That bug was real and is covered by a regression test.
   */
  all: string[];
  /** If any of these appear, the rule does not apply (keeps broader rules from swallowing more specific ones). */
  not?: string[];
  level: number;
}

/**
 * Ordered most-specific first. The first matching rule wins, which is why
 * "senior tech lead" (L8) must precede "tech lead" (L7), and "associate
 * director" (L11) must precede "director" (L12).
 */
const TITLE_RULES: readonly TitleRule[] = [
  // ---- C-suite and founders (L18) ----
  { all: ["chief", "executive"], level: 18 },
  { all: ["ceo"], level: 18 },
  { all: ["founder"], level: 18 },
  { all: ["c suite"], level: 18 },
  { all: ["coo"], level: 18 },
  { all: ["cfo"], level: 18 },
  { all: ["cto"], level: 18 },
  { all: ["cpo"], level: 18 },
  { all: ["cho"], level: 18 },
  { all: ["cso"], level: 18 },
  { all: ["cco"], level: 18 },

  // ---- VP band (L14-L17) ----
  { all: ["senior", "executive", "vp"], level: 17 },
  { all: ["senior", "vp"], level: 16 },
  { all: ["associate", "vp"], level: 14 },
  { all: ["vp"], level: 15 },
  { all: ["vice", "president"], level: 15 },

  // ---- Director band (L11-L13) ----
  { all: ["senior", "director"], level: 13 },
  { all: ["associate", "director"], level: 11 },
  { all: ["assistant", "director"], level: 11 },
  { all: ["director"], level: 12 },

  // ---- Head-of band: a department head sits at director level ----
  { all: ["associate", "head", "of"], level: 9 },
  { all: ["head", "of"], level: 10 },

  // ---- Architect track (L9-L12) ----
  { all: ["senior", "solution", "architect"], level: 12 },
  { all: ["solution", "architect"], level: 11 },
  { all: ["associate", "architect"], level: 9 },
  { all: ["architect"], level: 10 },

  // ---- Lead / principal band (L6-L8) ----
  { all: ["senior", "tech", "lead"], level: 8 },
  { all: ["associate", "tech", "lead"], level: 6 },
  { all: ["tech", "lead"], level: 7 },
  { all: ["principal", "engineer", "ii"], level: 8 },
  { all: ["principal", "engineer"], level: 7 },
  { all: ["principal"], level: 7 },

  // ---- Project and product tracks ----
  // These MUST precede the generic manager rules below: "Project Manager"
  // is L7, and a generic `manager` rule placed first would silently
  // promote it to L10.
  { all: ["associate", "delivery", "manager"], level: 9 },
  { all: ["delivery", "manager"], level: 10 },
  { all: ["senior", "project", "manager"], level: 8 },
  { all: ["project", "manager"], level: 7 },
  { all: ["associate", "group", "product", "manager"], level: 9 },
  { all: ["group", "product", "manager"], level: 10 },
  { all: ["senior", "product", "manager"], level: 8 },
  { all: ["associate", "product", "manager"], level: 5 },
  { all: ["product", "manager"], level: 6 },
  { all: ["product", "lead"], level: 7 },
  { all: ["apm", "ii"], level: 6 },
  { all: ["apm"], level: 5 },
  // "PC" sits at L4 in the Manager-Project column of the source document.
  { all: ["pc"], level: 4 },

  // ---- Manager band (L9-L10) ----
  { all: ["associate", "manager"], level: 9 },
  { all: ["assistant", "manager"], level: 9 },
  { all: ["senior", "manager"], level: 10 },
  { all: ["manager"], level: 10 },

  { all: ["lead"], level: 7, not: ["associate"] },

  // ---- Senior IC band (L5-L6) ----
  { all: ["senior", "engineer", "ii"], level: 6 },
  { all: ["senior", "engineer"], level: 5 },
  { all: ["senior"], level: 5 },

  // ---- Junior / mid IC band (L2-L4) ----
  { all: ["associate", "engineer"], level: 2 },
  { all: ["trainee"], level: 2 },
  { all: ["engineer", "ii"], level: 4 },
  { all: ["engineer"], level: 3 },
  { all: ["analyst", "2"], level: 3 },
  { all: ["analyst"], level: 2 },
  { all: ["executive"], level: 4 },
  { all: ["officer"], level: 4 },
  { all: ["associate"], level: 2 },
];

/**
 * Best-effort level for a job title, or null when nothing matches
 * confidently. Null is a deliberate outcome, not a failure: an unmapped
 * title should be reviewed by a human rather than guessed into a
 * leadership chart.
 */
export function inferGradeLevelFromTitle(title: string): number | null {
  const normalized = normalizeTitle(title);
  if (!normalized) return null;

  const words = new Set(normalized.split(" "));

  for (const rule of TITLE_RULES) {
    if (rule.not?.some((token) => words.has(token))) continue;
    if (rule.all.every((token) => words.has(token))) return rule.level;
  }
  return null;
}

/** Convenience wrapper returning the grade code, e.g. "L7". */
export function inferGradeCodeFromTitle(title: string): string | null {
  const level = inferGradeLevelFromTitle(title);
  return level === null ? null : gradeCodeForLevel(level);
}
