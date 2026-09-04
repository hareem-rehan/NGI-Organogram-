import { describe, expect, it } from "vitest";

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

  it("shows 'Vacant' for an unoccupied position and the occupant name for an occupied one", () => {
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
    expect(result.svg).toContain("Vacant");
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

  it("draws the occupancy dot the Occupied/Vacant legend rows are a key to", () => {
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
    // The legend previously advertised an "Occupied" green swatch that
    // matched no mark anywhere on the page.
    expect(result.svg).toContain(`r="4" fill="${EXPORT_COLORS.statusFilled}"`);
    expect(result.svg).toContain(`r="4" fill="${EXPORT_COLORS.statusVacant}"`);
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
    // Occupancy applies to every card, so its rows are unconditional...
    expect(plainChart.svg).toContain("Occupied");
    expect(plainChart.svg).toContain("Vacant");
    // ...but these describe marks that appear nowhere on this chart.
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
