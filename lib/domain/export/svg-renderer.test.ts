import { describe, expect, it } from "vitest";

import { NODE_HEIGHT } from "@/app/(app)/organogram/_lib/elk-layout";

import { EXPORT_COLORS } from "./colors";
import { renderOrganogramSvg, type SvgRenderMetadata, type SvgRenderNode } from "./svg-renderer";

function node(overrides: Partial<SvgRenderNode> & { positionId: string }): SvgRenderNode {
  return {
    title: `Title ${overrides.positionId}`,
    positionCode: `POS-${overrides.positionId}`,
    departmentName: "Engineering",
    departmentColor: "#16a34a",
    organizationalLevel: 1,
    jobGradeName: null,
    jobGradeCode: null,
    jobFamilyId: null,
    jobFamilyName: null,
    occupancyStatus: "vacant",
    occupantDisplayName: null,
    positionStatus: "ACTIVE",
    matchState: "none",
    ...overrides,
  };
}

const METADATA: SvgRenderMetadata = {
  companyName: "Acme Corp",
  effectiveDate: "2026-09-02",
  scopeLabel: "Full Company",
  focusLabel: null,
  filtersSummary: null,
  generatedAtLabel: "2026-09-02 10:00 UTC",
};

const BASE_OPTIONS = {
  includeLegend: true,
  includeMetadata: true,
  includeConfidentialityLabel: true,
  departments: [],
};

describe("renderOrganogramSvg — colour by sub-division", () => {
  it("fills a classified card with its family colour and lists families in the legend", () => {
    const positions = new Map([["p1", { x: 0, y: 0 }]]);
    const result = renderOrganogramSvg(
      [
        node({
          positionId: "p1",
          jobFamilyId: "fam-swe",
          jobFamilyName: "Software Engineering",
          jobGradeCode: "L7",
        }),
      ],
      [],
      positions,
      METADATA,
      {
        ...BASE_OPTIONS,
        colorMode: "family",
        familyColorById: new Map([["fam-swe", { fill: "#cbf2b1", accent: "#6fbf3f" }]]),
        families: [{ id: "fam-swe", name: "Software Engineering", color: "#6fbf3f" }],
      }
    );
    // The card body takes the family fill and the family accent edge.
    expect(result.svg).toContain('fill="#cbf2b1"');
    expect(result.svg).toContain('fill="#6fbf3f"');
    // The grade and family share the card's last line.
    expect(result.svg).toContain("L7 · Software Engineering");
    // The legend keys sub-divisions, not departments.
    expect(result.svg).toContain("Sub-divisions");
    expect(result.svg).not.toContain(">Departments<");
  });

  it("in department mode fills the card with a tint of the department colour and a Departments legend", () => {
    const positions = new Map([["p1", { x: 0, y: 0 }]]);
    const result = renderOrganogramSvg(
      [node({ positionId: "p1", jobFamilyId: "fam-swe", jobFamilyName: "Software Engineering" })],
      [],
      positions,
      METADATA,
      {
        ...BASE_OPTIONS,
        colorMode: "department",
        departments: [{ id: "d1", name: "Engineering", color: "#16a34a" }],
        familyColorById: new Map([["fam-swe", { fill: "#cbf2b1", accent: "#6fbf3f" }]]),
        families: [{ id: "fam-swe", name: "Software Engineering", color: "#6fbf3f" }],
      }
    );
    // The card body is a light tint of the department colour, not the family fill.
    expect(result.svg).toContain('fill="#ccebd7"'); // lightTint("#16a34a")
    expect(result.svg).not.toContain('fill="#cbf2b1"');
    expect(result.svg).toContain("Departments");
  });
});

describe("renderOrganogramSvg", () => {
  it("produces a well-formed SVG document with the expected root element", () => {
    const positions = new Map([["root", { x: 0, y: 0 }]]);
    const result = renderOrganogramSvg(
      [node({ positionId: "root" })],
      [],
      positions,
      METADATA,
      BASE_OPTIONS
    );
    expect(result.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(result.svg).toMatch(/<\/svg>$/);
    expect(result.totalWidth).toBeGreaterThan(0);
    expect(result.totalHeight).toBeGreaterThan(0);
  });

  it("renders the company name and effective date in the header", () => {
    const positions = new Map([["root", { x: 0, y: 0 }]]);
    const result = renderOrganogramSvg(
      [node({ positionId: "root" })],
      [],
      positions,
      METADATA,
      BASE_OPTIONS
    );
    expect(result.svg).toContain("Acme Corp");
    expect(result.svg).toContain("2026-09-02");
  });

  it("escapes an ampersand in a company/position name", () => {
    const positions = new Map([["root", { x: 0, y: 0 }]]);
    const result = renderOrganogramSvg(
      [node({ positionId: "root", title: "R&D Lead" })],
      [],
      positions,
      { ...METADATA, companyName: "Smith & Sons" },
      BASE_OPTIONS
    );
    expect(result.svg).toContain("Smith &amp; Sons");
    expect(result.svg).toContain("R&amp;D Lead");
    expect(result.svg).not.toContain("Smith & Sons");
  });

  it("escapes angle brackets in a position title, neutralizing an injection attempt", () => {
    const positions = new Map([["root", { x: 0, y: 0 }]]);
    const result = renderOrganogramSvg(
      [node({ positionId: "root", title: "<script>alert(1)</script>" })],
      [],
      positions,
      METADATA,
      BASE_OPTIONS
    );
    expect(result.svg).not.toContain("<script>");
    expect(result.svg).toContain("&lt;script&gt;");
  });

  it("never contains a <script> element, foreignObject, or external image reference regardless of input", () => {
    const positions = new Map([["root", { x: 0, y: 0 }]]);
    const result = renderOrganogramSvg(
      [
        node({
          positionId: "root",
          title: '"><foreignObject><script>evil()</script></foreignObject>',
        }),
      ],
      [],
      positions,
      METADATA,
      BASE_OPTIONS
    );
    expect(result.svg).not.toMatch(/<script/i);
    expect(result.svg).not.toMatch(/<foreignObject/i);
    expect(result.svg).not.toMatch(/<image/i);
    expect(result.svg).not.toMatch(/xlink:href\s*=\s*"https?:/i);
  });

  it("renders correct Unicode names without mangling them", () => {
    const positions = new Map([["root", { x: 0, y: 0 }]]);
    const result = renderOrganogramSvg(
      [
        node({
          positionId: "root",
          title: "José García",
          occupantDisplayName: "José García",
          occupancyStatus: "occupied",
        }),
      ],
      [],
      positions,
      METADATA,
      BASE_OPTIONS
    );
    expect(result.svg).toContain("José García");
  });

  it("includes the department's real color as a fill", () => {
    const positions = new Map([["root", { x: 0, y: 0 }]]);
    const result = renderOrganogramSvg(
      [node({ positionId: "root", departmentColor: "#ff00aa" })],
      [],
      positions,
      METADATA,
      BASE_OPTIONS
    );
    expect(result.svg).toContain("#ff00aa");
  });

  it("falls back to the neutral border color when departmentColor is null", () => {
    const positions = new Map([["root", { x: 0, y: 0 }]]);
    const result = renderOrganogramSvg(
      [node({ positionId: "root", departmentColor: null })],
      [],
      positions,
      METADATA,
      BASE_OPTIONS
    );
    // Asserted against the token, never a hardcoded hex — this test
    // previously pinned the pre-DotZero `#e2e8f0` and so kept passing
    // while the export rendered an entirely stale palette.
    expect(result.svg).toContain(EXPORT_COLORS.border);
  });

  it("never writes 'Vacant' for an unoccupied position, but shows the occupant name for an occupied one", () => {
    const positions = new Map([
      ["vacantPos", { x: 0, y: 0 }],
      ["occupiedPos", { x: 300, y: 0 }],
    ]);
    const result = renderOrganogramSvg(
      [
        node({ positionId: "vacantPos", occupancyStatus: "vacant" }),
        node({
          positionId: "occupiedPos",
          occupancyStatus: "occupied",
          occupantDisplayName: "Nadia Volkov",
        }),
      ],
      [],
      positions,
      METADATA,
      BASE_OPTIONS
    );
    // Stakeholder Demo-1: the chart must not surface vacancies — a vacant
    // role shows no name and no "Vacant" wording anywhere (card or legend).
    expect(result.svg).not.toContain("Vacant");
    expect(result.svg).toContain("Nadia Volkov");
  });

  it("labels a PLANNED position and an INACTIVE position distinctly, in text (never color alone)", () => {
    const positions = new Map([
      ["planned", { x: 0, y: 0 }],
      ["inactive", { x: 300, y: 0 }],
    ]);
    const result = renderOrganogramSvg(
      [
        node({ positionId: "planned", positionStatus: "PLANNED" }),
        node({ positionId: "inactive", positionStatus: "INACTIVE" }),
      ],
      [],
      positions,
      METADATA,
      BASE_OPTIONS
    );
    expect(result.svg).toContain("PLANNED");
    expect(result.svg).toContain("INACTIVE");
  });

  it("labels Match and Context nodes distinctly in text", () => {
    const positions = new Map([
      ["m", { x: 0, y: 0 }],
      ["c", { x: 300, y: 0 }],
    ]);
    const result = renderOrganogramSvg(
      [
        node({ positionId: "m", matchState: "match" }),
        node({ positionId: "c", matchState: "context" }),
      ],
      [],
      positions,
      METADATA,
      BASE_OPTIONS
    );
    expect(result.svg).toContain("MATCH");
    expect(result.svg).toContain("CONTEXT");
  });

  it("renders a solid connector path (never a dashed stroke) between two connected nodes", () => {
    const positions = new Map([
      ["parent", { x: 0, y: 0 }],
      ["child", { x: 0, y: 300 }],
    ]);
    const result = renderOrganogramSvg(
      [node({ positionId: "parent" }), node({ positionId: "child" })],
      [{ sourcePositionId: "parent", targetPositionId: "child" }],
      positions,
      METADATA,
      BASE_OPTIONS
    );
    expect(result.svg).toContain("<path");
    expect(result.svg).not.toContain("stroke-dasharray");
  });

  it("never renders an edge whose source or target node is absent from the node list", () => {
    const positions = new Map([["only", { x: 0, y: 0 }]]);
    const result = renderOrganogramSvg(
      [node({ positionId: "only" })],
      [{ sourcePositionId: "only", targetPositionId: "missing" }],
      positions,
      METADATA,
      BASE_OPTIONS
    );
    // No path should be emitted for the dangling reference.
    expect(result.svg).not.toContain("<path");
  });

  it("renders a safe, clear message for an empty node list rather than a blank or broken document", () => {
    const result = renderOrganogramSvg([], [], new Map(), METADATA, BASE_OPTIONS);
    expect(result.svg).toContain("No positions to export.");
    expect(result.svg).toMatch(/^<svg/);
    expect(result.svg).toMatch(/<\/svg>$/);
  });

  it("is deterministic — identical input produces byte-identical output", () => {
    const positions = new Map([
      ["a", { x: 10, y: 20 }],
      ["b", { x: 300, y: 200 }],
    ]);
    const nodes = [node({ positionId: "a" }), node({ positionId: "b" })];
    const edges = [{ sourcePositionId: "a", targetPositionId: "b" }];
    const first = renderOrganogramSvg(nodes, edges, positions, METADATA, BASE_OPTIONS);
    const second = renderOrganogramSvg(nodes, edges, positions, METADATA, BASE_OPTIONS);
    expect(first.svg).toBe(second.svg);
    expect(first.totalWidth).toBe(second.totalWidth);
    expect(first.totalHeight).toBe(second.totalHeight);
  });

  it("omits metadata header content when includeMetadata is false", () => {
    const positions = new Map([["root", { x: 0, y: 0 }]]);
    const result = renderOrganogramSvg([node({ positionId: "root" })], [], positions, METADATA, {
      ...BASE_OPTIONS,
      includeMetadata: false,
    });
    expect(result.svg).not.toContain("Acme Corp");
  });

  it("includes the confidentiality label only when requested", () => {
    const positions = new Map([["root", { x: 0, y: 0 }]]);
    const withLabel = renderOrganogramSvg(
      [node({ positionId: "root" })],
      [],
      positions,
      METADATA,
      BASE_OPTIONS
    );
    const withoutLabel = renderOrganogramSvg(
      [node({ positionId: "root" })],
      [],
      positions,
      METADATA,
      { ...BASE_OPTIONS, includeConfidentialityLabel: false }
    );
    expect(withLabel.svg).toContain("Confidential");
    expect(withoutLabel.svg).not.toContain("Confidential");
  });

  it("includes a listed department's name and color in the legend", () => {
    const positions = new Map([["root", { x: 0, y: 0 }]]);
    const result = renderOrganogramSvg([node({ positionId: "root" })], [], positions, METADATA, {
      ...BASE_OPTIONS,
      departments: [{ id: "d1", name: "Sales & Marketing", color: "#123456" }],
    });
    expect(result.svg).toContain("Sales &amp; Marketing");
    expect(result.svg).toContain("#123456");
  });

  it("declares an explicit sans-serif font — neither renderer defaults to one", () => {
    const positions = new Map([["root", { x: 0, y: 0 }]]);
    const result = renderOrganogramSvg(
      [node({ positionId: "root" })],
      [],
      positions,
      METADATA,
      BASE_OPTIONS
    );
    // librsvg (PNG) and svg-to-pdfkit (PDF) both fall back to a SERIF face
    // when font-family is absent, which is how exports shipped in Times
    // while the app itself is sans-serif.
    expect(result.svg).toContain('font-family="Helvetica, Arial, sans-serif"');
  });

  it("draws an occupancy dot only for occupied cards, never a vacant dot", () => {
    const positions = new Map([
      ["vacantPos", { x: 0, y: 0 }],
      ["occupiedPos", { x: 300, y: 0 }],
    ]);
    const result = renderOrganogramSvg(
      [
        node({ positionId: "vacantPos", occupancyStatus: "vacant" }),
        node({
          positionId: "occupiedPos",
          occupancyStatus: "occupied",
          occupantDisplayName: "Ada Lovelace",
        }),
      ],
      [],
      positions,
      METADATA,
      BASE_OPTIONS
    );
    // The occupied card carries the green dot (keyed by the "Occupied"
    // legend row); the vacant card carries no dot at all — vacancy is
    // conveyed only by the absent name, exactly as on screen.
    expect(result.svg).toContain(`r="4" fill="${EXPORT_COLORS.statusFilled}"`);
    expect(result.svg).not.toContain(`fill="${EXPORT_COLORS.statusVacant}"`);
  });

  it("lists a status legend row only when a node actually carries that state", () => {
    const positions = new Map([["root", { x: 0, y: 0 }]]);
    const plainChart = renderOrganogramSvg(
      [node({ positionId: "root", positionStatus: "ACTIVE", matchState: "none" })],
      [],
      positions,
      METADATA,
      BASE_OPTIONS
    );
    // The occupied dot always has its key; "Vacant" is never listed
    // (vacancies are not surfaced on the chart)...
    expect(plainChart.svg).toContain("Occupied");
    expect(plainChart.svg).not.toContain("Vacant");
    // ...and these describe marks that appear nowhere on this chart.
    expect(plainChart.svg).not.toContain("Planned position");
    expect(plainChart.svg).not.toContain("Inactive position");
    expect(plainChart.svg).not.toContain(">Match<");

    const plannedChart = renderOrganogramSvg(
      [node({ positionId: "root", positionStatus: "PLANNED" })],
      [],
      positions,
      METADATA,
      BASE_OPTIONS
    );
    expect(plannedChart.svg).toContain("Planned position");
  });

  // This renderer draws its OWN copy of the interactive card, so the two
  // diverge silently unless changed together. These pin the compact
  // layout agreed in the Demo 1 feedback.
  it("renders the compact card: occupant, role title and grade level", () => {
    const positions = new Map([["root", { x: 0, y: 0 }]]);
    const result = renderOrganogramSvg(
      [
        node({
          positionId: "root",
          title: "Tech Lead",
          occupancyStatus: "occupied",
          occupantDisplayName: "John Doe",
          jobGradeCode: "L7",
          jobFamilyId: null,
          jobFamilyName: null,
        }),
      ],
      [],
      positions,
      METADATA,
      BASE_OPTIONS
    );
    expect(result.svg).toContain("John Doe");
    expect(result.svg).toContain("Tech Lead");
    expect(result.svg).toContain(">L7<");
  });

  it("no longer prints the position code or the department/level line on a card", () => {
    const positions = new Map([["root", { x: 0, y: 0 }]]);
    const result = renderOrganogramSvg(
      [
        node({
          positionId: "root",
          positionCode: "POS-SECRET",
          departmentName: "Engineering",
          organizationalLevel: 4,
          occupancyStatus: "occupied",
          occupantDisplayName: "John Doe",
        }),
      ],
      [],
      positions,
      METADATA,
      // Legend off, so a department name in the legend cannot mask the
      // assertion that the CARD no longer repeats it.
      { ...BASE_OPTIONS, includeLegend: false }
    );
    expect(result.svg).not.toContain("POS-SECRET");
    expect(result.svg).not.toContain("Engineering · Level 4");
  });

  it("keeps every card's text inside the card box, even with a two-line title", () => {
    const positions = new Map([["root", { x: 0, y: 0 }]]);
    const result = renderOrganogramSvg(
      [
        node({
          positionId: "root",
          title: "Associate Director of Engineering and Platform Operations",
          occupancyStatus: "occupied",
          occupantDisplayName: "John Doe",
          jobGradeCode: "L11",
          jobFamilyId: null,
          jobFamilyName: null,
        }),
      ],
      [],
      positions,
      METADATA,
      { ...BASE_OPTIONS, includeLegend: false, includeMetadata: false }
    );
    // Every y coordinate drawn inside a CARD GROUP must fit within
    // NODE_HEIGHT, or text silently renders outside its own box — the
    // failure mode hard-coded coordinates invite. Scoped to the card's own
    // `<g transform="translate(...)">`, because coordinates elsewhere in
    // the document (the footer, for one) are page-absolute and would
    // otherwise be compared against a card-relative bound.
    // Matched on `opacity`, which only a CARD group carries — the outer
    // graph wrapper is also a translated <g> and would otherwise match
    // first, capturing the (empty) edges group instead.
    const cardGroup = /<g transform="translate\([^)]*\)" opacity="[^"]*">(.*?)<\/g>/s.exec(
      result.svg
    )?.[1];
    expect(cardGroup).toBeDefined();
    const ys = [...(cardGroup ?? "").matchAll(/\sy="(\d+(?:\.\d+)?)"/g)].map((m) => Number(m[1]));
    expect(ys.length).toBeGreaterThan(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(NODE_HEIGHT);
  });

  it("colors a status badge to match its own legend swatch", () => {
    const positions = new Map([["root", { x: 0, y: 0 }]]);
    const planned = renderOrganogramSvg(
      [node({ positionId: "root", positionStatus: "PLANNED" })],
      [],
      positions,
      METADATA,
      BASE_OPTIONS
    );
    // The badge and its legend row must agree; the badge used to render
    // in muted gray regardless of which status it announced.
    expect(planned.svg).toContain(`fill="${EXPORT_COLORS.statusPlanned}">PLANNED`);
  });
});

describe("renderOrganogramSvg — department tier", () => {
  const POSITIONS = new Map([
    ["root", { x: 0, y: 0 }],
    ["dept:eng", { x: 0, y: 200 }],
  ]);

  function renderWithDepartment(overrides: Partial<SvgRenderNode> = {}) {
    return renderOrganogramSvg(
      [
        node({
          positionId: "root",
          title: "CEO",
          occupancyStatus: "occupied",
          occupantDisplayName: "Ada",
        }),
        node({
          positionId: "dept:eng",
          kind: "department",
          title: "Engineering",
          departmentName: "Engineering",
          occupancyStatus: "occupied",
          ...overrides,
        }),
      ],
      [{ sourcePositionId: "root", targetPositionId: "dept:eng" }],
      POSITIONS,
      METADATA,
      BASE_OPTIONS
    ).svg;
  }

  it("draws the department name in caps with its role count", () => {
    const svg = renderWithDepartment();
    expect(svg).toContain(">ENGINEERING<");
    expect(svg).toContain(">0 roles<");
  });

  it("counts the roles from the edges actually being drawn", () => {
    const svg = renderOrganogramSvg(
      [
        node({ positionId: "dept:eng", kind: "department", departmentName: "Engineering" }),
        node({ positionId: "a" }),
        node({ positionId: "b" }),
      ],
      [
        { sourcePositionId: "dept:eng", targetPositionId: "a" },
        { sourcePositionId: "dept:eng", targetPositionId: "b" },
      ],
      new Map([
        ["dept:eng", { x: 0, y: 0 }],
        ["a", { x: 0, y: 200 }],
        ["b", { x: 300, y: 200 }],
      ]),
      METADATA,
      BASE_OPTIONS
    ).svg;
    expect(svg).toContain(">2 roles<");
  });

  it("gives a department heading no occupancy dot and no 'Vacant' text", () => {
    // Drawn on its own, so the assertion cannot be satisfied by some
    // other card on the page.
    const svg = renderOrganogramSvg(
      [node({ positionId: "dept:eng", kind: "department", departmentName: "Engineering" })],
      [],
      new Map([["dept:eng", { x: 0, y: 0 }]]),
      METADATA,
      { ...BASE_OPTIONS, includeLegend: false }
    ).svg;
    expect(svg).not.toContain(">Vacant<");
    expect(svg).not.toContain("<circle");
  });

  it("fills the card rather than outlining it, so it never reads as a person", () => {
    const svg = renderWithDepartment();
    // Fully colour-filled with a light tint of the department colour.
    expect(svg).toContain('fill="#ccebd7"'); // lightTint("#16a34a")
  });
});
