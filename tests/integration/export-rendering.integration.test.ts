import { describe, expect, it } from "vitest";

import {
  renderOrganogramSvg,
  type SvgRenderMetadata,
  type SvgRenderNode,
} from "@/lib/domain/export/svg-renderer";
import { renderSvgToPng, PngSizeError } from "@/lib/domain/export/png-renderer";
import {
  renderOrganogramPdf,
  MAX_PDF_TILE_PAGES,
  PdfPageLimitError,
} from "@/lib/domain/export/pdf-renderer";
import { MAX_PNG_DIMENSION_PX, MAX_PNG_TOTAL_PIXELS } from "@/lib/domain/export/types";

/**
 * `sharp`/`pdfkit` are real native/binary-touching libraries, guarded by
 * `import "server-only"` in both renderer modules exactly like every
 * repository/service in this app — so, per this project's established
 * convention (server-only code is exercised via the integration suite,
 * never the jsdom-based unit suite), their actual PNG/PDF byte output is
 * verified here rather than in a *.test.ts file. No database is touched
 * by these specific tests; they simply share this suite's Node
 * environment and `server-only` resolution condition.
 */

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

const OPTIONS = {
  includeLegend: true,
  includeMetadata: true,
  includeConfidentialityLabel: true,
  departments: [],
};

function countPdfPages(buffer: Buffer): number {
  const text = buffer.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page[^s]/g) ?? [];
  return matches.length;
}

function buildSvgResult(nodeCount: number) {
  const nodes: SvgRenderNode[] = [];
  const positions = new Map<string, { x: number; y: number }>();
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodeCount)));
  for (let i = 0; i < nodeCount; i++) {
    const id = `pos-${i}`;
    nodes.push(node({ positionId: id }));
    positions.set(id, { x: (i % columns) * 320, y: Math.floor(i / columns) * 220 });
  }
  return renderOrganogramSvg(nodes, [], positions, METADATA, OPTIONS);
}

/** All nodes placed in a single wide row — the pathological "one manager, N direct reports" shape that drives the PDF tiler's column count (not the PNG renderer, which has no page concept) toward its limit. */
function buildWideSvgResult(nodeCount: number) {
  const nodes: SvgRenderNode[] = [];
  const positions = new Map<string, { x: number; y: number }>();
  for (let i = 0; i < nodeCount; i++) {
    const id = `pos-${i}`;
    nodes.push(node({ positionId: id }));
    positions.set(id, { x: i * 320, y: 0 });
  }
  return renderOrganogramSvg(nodes, [], positions, METADATA, OPTIONS);
}

describe("PNG rendering (sharp)", () => {
  it("produces a valid PNG with the correct signature and MIME-equivalent format", async () => {
    const svgResult = buildSvgResult(1);
    const result = await renderSvgToPng(
      svgResult.svg,
      svgResult.totalWidth,
      svgResult.totalHeight,
      1
    );
    expect(result.buffer.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  });

  it("produces dimensions matching the base size at 1x scale", async () => {
    const svgResult = buildSvgResult(1);
    const result = await renderSvgToPng(
      svgResult.svg,
      svgResult.totalWidth,
      svgResult.totalHeight,
      1
    );
    expect(result.width).toBe(Math.round(svgResult.totalWidth));
    expect(result.height).toBe(Math.round(svgResult.totalHeight));
  });

  it("doubles/triples dimensions at 2x/3x scale", async () => {
    const svgResult = buildSvgResult(1);
    const at2x = await renderSvgToPng(
      svgResult.svg,
      svgResult.totalWidth,
      svgResult.totalHeight,
      2
    );
    const at3x = await renderSvgToPng(
      svgResult.svg,
      svgResult.totalWidth,
      svgResult.totalHeight,
      3
    );
    expect(at2x.width).toBe(Math.round(svgResult.totalWidth * 2));
    expect(at3x.width).toBe(Math.round(svgResult.totalWidth * 3));
  });

  it("renders a graph with several nodes into one complete PNG covering the whole graph, not a viewport crop", async () => {
    const svgResult = buildSvgResult(12);
    const result = await renderSvgToPng(
      svgResult.svg,
      svgResult.totalWidth,
      svgResult.totalHeight,
      1
    );
    expect(result.width).toBe(Math.round(svgResult.totalWidth));
    expect(result.height).toBe(Math.round(svgResult.totalHeight));
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it("renders correctly with a long title present, without crashing or truncating the file", async () => {
    const nodes = [
      node({
        positionId: "long",
        title: "Senior Vice President of Global Engineering Operations and Platform Strategy",
      }),
    ];
    const positions = new Map([["long", { x: 0, y: 0 }]]);
    const svgResult = renderOrganogramSvg(nodes, [], positions, METADATA, OPTIONS);
    const result = await renderSvgToPng(
      svgResult.svg,
      svgResult.totalWidth,
      svgResult.totalHeight,
      1
    );
    expect(result.buffer.subarray(0, 4).toString("hex")).toBe("89504e47".slice(0, 8));
  });

  it("rejects a PNG request whose dimensions exceed the maximum supported pixel dimension", async () => {
    await expect(
      renderSvgToPng("<svg></svg>", MAX_PNG_DIMENSION_PX + 100, 100, 1)
    ).rejects.toBeInstanceOf(PngSizeError);
  });

  it("rejects a PNG request whose total pixel count exceeds the maximum, even if neither dimension alone is oversized", async () => {
    const side = Math.ceil(Math.sqrt(MAX_PNG_TOTAL_PIXELS)) + 100;
    await expect(renderSvgToPng("<svg></svg>", side, side, 1)).rejects.toBeInstanceOf(PngSizeError);
  });

  it("does not attempt to rasterize at all once a size limit is exceeded (no blank/corrupt file is ever produced)", async () => {
    let threw = false;
    try {
      await renderSvgToPng("<svg></svg>", MAX_PNG_DIMENSION_PX + 1, 10, 1);
    } catch (error) {
      threw = true;
      expect(error).toBeInstanceOf(PngSizeError);
      expect((error as Error).message).toMatch(/PDF instead/i);
    }
    expect(threw).toBe(true);
  });
});

describe("PDF rendering (pdfkit + svg-to-pdfkit)", () => {
  const pdfMetadata = {
    companyName: "Acme Corp",
    scopeLabel: "Full Company",
    effectiveDate: "2026-09-02",
    generatedAtLabel: "2026-09-02 10:00 UTC",
  };

  it("produces a valid PDF with the correct signature", async () => {
    const svgResult = buildSvgResult(1);
    const result = await renderOrganogramPdf(svgResult, "A4", "SINGLE_PAGE", pdfMetadata);
    expect(result.buffer.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("a small graph in SINGLE_PAGE mode produces exactly one page", async () => {
    const svgResult = buildSvgResult(1);
    const result = await renderOrganogramPdf(svgResult, "A4", "SINGLE_PAGE", pdfMetadata);
    expect(result.pageCount).toBe(1);
    expect(result.layoutMode).toBe("SINGLE_PAGE");
    expect(countPdfPages(result.buffer)).toBe(1);
  });

  it("forcing MULTI_PAGE_TILED on a tiny graph still produces an overview page plus at least one detail tile", async () => {
    const svgResult = buildSvgResult(1);
    const result = await renderOrganogramPdf(svgResult, "A4", "MULTI_PAGE_TILED", pdfMetadata);
    expect(result.pageCount).toBeGreaterThanOrEqual(2);
    expect(countPdfPages(result.buffer)).toBe(result.pageCount);
  });

  it("AUTO mode selects SINGLE_PAGE for a small graph and MULTI_PAGE_TILED for a large wide/deep one", async () => {
    const small = buildSvgResult(1);
    const smallResult = await renderOrganogramPdf(small, "A4", "AUTO", pdfMetadata);
    expect(smallResult.layoutMode).toBe("SINGLE_PAGE");

    const large = buildSvgResult(200);
    const largeResult = await renderOrganogramPdf(large, "A4", "AUTO", pdfMetadata);
    expect(largeResult.layoutMode).toBe("MULTI_PAGE_TILED");
    expect(largeResult.pageCount).toBeGreaterThan(1);
  });

  it("A3 landscape allows a moderately larger graph to still fit on a single page than A4 would", async () => {
    const medium = buildSvgResult(20);
    const a4Result = await renderOrganogramPdf(medium, "A4", "AUTO", pdfMetadata);
    const a3Result = await renderOrganogramPdf(medium, "A3", "AUTO", pdfMetadata);
    // Not asserting exact mode for both (depends on generated graph
    // proportions), but A3's larger page must never produce MORE pages
    // than A4 for the identical graph.
    expect(a3Result.pageCount).toBeLessThanOrEqual(a4Result.pageCount);
  });

  it("records the page count accurately for a genuinely large multi-page export", async () => {
    const large = buildSvgResult(500);
    const result = await renderOrganogramPdf(large, "A3", "MULTI_PAGE_TILED", pdfMetadata);
    expect(result.pageCount).toBe(countPdfPages(result.buffer));
    expect(result.pageCount).toBeGreaterThan(2);
  });

  it("renders an empty organization safely as a valid, small single-page PDF", async () => {
    const empty = renderOrganogramSvg([], [], new Map(), METADATA, OPTIONS);
    const result = await renderOrganogramPdf(empty, "A4", "AUTO", pdfMetadata);
    expect(result.buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(result.pageCount).toBe(1);
  });

  it("handles a long company name / title without throwing", async () => {
    const svgResult = buildSvgResult(1);
    const result = await renderOrganogramPdf(svgResult, "A4", "SINGLE_PAGE", {
      ...pdfMetadata,
      companyName:
        "A Very Long Fictional Holding Company Name That Keeps Going International Group PLC",
    });
    expect(result.buffer.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("rejects (quickly, never hangs) a pathologically wide graph whose tile grid would exceed MAX_PDF_TILE_PAGES, instead of generating hundreds of pages", async () => {
    // One manager with ~300 direct reports, all on one row — this is
    // exactly the shape that made an earlier, unguarded version of this
    // renderer spend minutes re-parsing the full SVG string once per
    // tile page. The fix (pdf-renderer.ts's MAX_PDF_TILE_PAGES check)
    // must reject BEFORE any page is drawn, so this assertion also
    // implicitly proves the rejection is fast — the test itself has no
    // explicit timeout override, so a regression back to unbounded
    // tiling would make this test file time out rather than pass slowly.
    const wide = buildWideSvgResult(300);
    await expect(
      renderOrganogramPdf(wide, "A3", "MULTI_PAGE_TILED", pdfMetadata)
    ).rejects.toBeInstanceOf(PdfPageLimitError);
  });

  it("a graph within the tile-page limit still renders normally in MULTI_PAGE_TILED mode", async () => {
    const wide = buildWideSvgResult(20);
    const result = await renderOrganogramPdf(wide, "A3", "MULTI_PAGE_TILED", pdfMetadata);
    expect(result.pageCount).toBeGreaterThan(1);
    expect(result.pageCount).toBeLessThanOrEqual(MAX_PDF_TILE_PAGES + 1);
    expect(countPdfPages(result.buffer)).toBe(result.pageCount);
  });
});
