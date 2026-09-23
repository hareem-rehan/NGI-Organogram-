/**
 * The company's standard role catalogue — the "PMF Levels Mapping": for
 * each career track, the position title at each level (L2–L18), split into
 * an IC ladder and a Manager ladder. Transcribed from the company's own
 * Levels Mapping reference.
 *
 * This is the source the Career Framework's "Populate standard roles"
 * action reads to fill a job family's matrix in one click, instead of the
 * user typing every title by hand. It is generic level nomenclature, not
 * employee data (CLAUDE.md §1.11).
 *
 * A track exposes an `ic` map and/or a `manager` map, keyed by level code
 * (e.g. "L7"). A missing level in a map means that cell is blank in the
 * reference and no title is created for it.
 */
export type PmfTrackKey = "ENGINEERING" | "PROJECT" | "PRODUCT" | "HR" | "IT";

export interface PmfTrack {
  key: PmfTrackKey;
  label: string;
  /** IC-ladder titles by level code. Absent for tracks that run a manager ladder only. */
  ic?: Readonly<Record<string, string>>;
  /** Manager-ladder titles by level code. */
  manager?: Readonly<Record<string, string>>;
}

// Shared senior rungs (L11–L18) that every manager-type ladder uses.
const SENIOR_MANAGER_RUNGS: Readonly<Record<string, string>> = {
  L11: "Associate Director",
  L12: "Director",
  L13: "Senior Director",
  L14: "Associate VP",
  L15: "VP",
  L16: "Senior VP",
  L17: "Senior Executive VP",
  L18: "C-Suite",
};

export const PMF_TRACKS: readonly PmfTrack[] = [
  {
    key: "ENGINEERING",
    label: "Engineering",
    ic: {
      L2: "Trainee / Associate",
      L3: "Software Engineer",
      L4: "Software Engineer II",
      L5: "Senior Software / QA / DevOps Engineer",
      L6: "Senior Software / QA / DevOps Engineer II",
      L7: "Principal Software Engineer",
      L8: "Principal Software Engineer II",
      L9: "Associate Architect",
      L10: "Architect",
      L11: "Solution Architect",
      L12: "Senior Solution Architect",
    },
    manager: {
      L6: "Associate Tech Lead",
      L7: "Tech Lead",
      L8: "Senior Tech Lead",
      L9: "Associate Manager",
      L10: "Manager",
      ...SENIOR_MANAGER_RUNGS,
    },
  },
  {
    key: "PROJECT",
    label: "Project",
    manager: {
      L4: "PC",
      L5: "APM 1",
      L6: "APM II",
      L7: "Project Manager / Technical Project Manager",
      L8: "Senior Project Manager",
      L9: "Associate Delivery Manager",
      L10: "Delivery Manager",
      ...SENIOR_MANAGER_RUNGS,
    },
  },
  {
    key: "PRODUCT",
    label: "Product",
    ic: {
      L2: "Trainee / Associate",
      L3: "Product / Business Analyst",
      L4: "Product / Business Analyst 2",
      L5: "Senior Product / Business Analyst",
    },
    manager: {
      L6: "Associate Product Manager",
      L7: "Product Manager / Technical Product Manager",
      L8: "Senior Product Manager",
      L9: "Associate Group Product Manager",
      L10: "Group Product Manager",
      ...SENIOR_MANAGER_RUNGS,
    },
  },
  {
    key: "HR",
    label: "HR",
    manager: {
      L2: "Trainee HR Executive",
      L3: "Jr. HR Executive",
      L4: "HR Executive",
      L5: "Sr. HR Executive",
      L6: "Associate HR Manager",
      L7: "HR Manager",
      L8: "Sr. HR Manager",
      L9: "Associate Head of HR",
      L10: "Head of HR",
      ...SENIOR_MANAGER_RUNGS,
    },
  },
  {
    key: "IT",
    label: "IT",
    manager: {
      L2: "Trainee IT Officer",
      L4: "IT Officer",
      L5: "Sr. IT Officer",
      L6: "Associate IT Manager",
      L7: "IT Manager",
      L8: "IT Sr. Manager",
      L9: "Associate Head of IT Ops.",
      L10: "Head of IT Ops.",
    },
  },
];

const TRACK_BY_KEY = new Map<PmfTrackKey, PmfTrack>(PMF_TRACKS.map((t) => [t.key, t]));

export function getPmfTrack(key: PmfTrackKey): PmfTrack | undefined {
  return TRACK_BY_KEY.get(key);
}

export const PMF_TRACK_KEYS: readonly PmfTrackKey[] = PMF_TRACKS.map((t) => t.key);

/** A flat list of (levelCode, title) for a track's IC or Manager ladder, in a stable order. */
export function pmfLadderEntries(
  track: PmfTrack,
  ladder: "ic" | "manager"
): { levelCode: string; title: string }[] {
  const map = track[ladder];
  if (!map) return [];
  return Object.entries(map).map(([levelCode, title]) => ({ levelCode, title }));
}
