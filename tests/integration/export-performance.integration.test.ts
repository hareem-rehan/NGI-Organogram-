import { describe, expect, it } from "vitest";

import {
  renderOrganogramSvg,
  type SvgRenderMetadata,
  type SvgRenderNode,
} from "@/lib/domain/export/svg-renderer";
import {
  assertPngWithinSafeRenderBudget,
  PngPerformanceLimitError,
  renderSvgToPng,
} from "@/lib/domain/export/png-renderer";
import { renderOrganogramPdf, PdfPageLimitError } from "@/lib/domain/export/pdf-renderer";

/**
 * Phase 13 Step 14 — PDF/PNG export TIMING at scale, reusing the exact
 * node/metadata builder pattern already established in
 * tests/integration/export-rendering.integration.test.ts (which covers
 * correctness, including the wide-hierarchy tile-page-limit rejection —
 * deliberately NOT re-tested here for correctness, only for how fast that
 * rejection happens).
 *
 * Thresholds are pre-committed in docs/PERFORMANCE_REPORT.md (rows 9-14)
 * BEFORE this file was ever run against real numbers.
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

const PDF_METADATA = {
  companyName: "Acme Corp",
  scopeLabel: "Full Company",
  effectiveDate: "2026-09-02",
  generatedAtLabel: "2026-09-02 10:00 UTC",
};

/** A grid layout (roughly square) — the same "normal" shape used by export-rendering.integration.test.ts's buildSvgResult, as opposed to the pathological single-row "wide" shape. */
function buildGridSvgResult(nodeCount: number) {
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

/** One manager with N direct reports on a single row — the shape that drives the PDF tiler's column count toward (and, at large N, past) MAX_PDF_TILE_PAGES. */
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

describe("Export performance — PNG rendering at scale", () => {
  it("renders a 100-node grid organogram to PNG within threshold", async () => {
    const svgResult = buildGridSvgResult(100);
    const start = performance.now();
    const result = await renderSvgToPng(
      svgResult.svg,
      svgResult.totalWidth,
      svgResult.totalHeight,
      1
    );
    const durationMs = performance.now() - start;
    console.log(
      `[export-performance][PNG][100 nodes] ${durationMs.toFixed(0)}ms (threshold 800ms)`
    );
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(durationMs).toBeLessThan(800);
  });

  it("renders a 250-node grid organogram to PNG within threshold (the largest size still allowed, Phase 13.1 DEF-010 remediation)", async () => {
    const svgResult = buildGridSvgResult(250);
    const start = performance.now();
    const result = await renderSvgToPng(
      svgResult.svg,
      svgResult.totalWidth,
      svgResult.totalHeight,
      1
    );
    const durationMs = performance.now() - start;
    console.log(
      `[export-performance][PNG][250 nodes] ${durationMs.toFixed(0)}ms (threshold 3000ms)`
    );
    expect(result.buffer.length).toBeGreaterThan(0);
    expect(durationMs).toBeLessThan(3000);
  });

  // Phase 13.1 (DEF-010 remediation): 500/1,000-node PNG requests are no
  // longer expected to RENDER within a time threshold — they are rejected
  // outright by `assertPngWithinSafeRenderBudget` before rendering is even
  // attempted (export.service.ts calls this before creating an ExportJob
  // row at all, per Step 9.6 — "do not queue a PNG job known to exceed
  // limits"). See docs/PERFORMANCE_REPORT.md and
  // docs/phase-reports/PHASE_13_1_PERFORMANCE_REMEDIATION.md for the full
  // benchmark table this 20-megapixel/~250-node cutoff was derived from.
  it("rejects a 500-node grid organogram PNG request quickly, recommending PDF (Phase 13.1 safe PNG limit)", () => {
    const svgResult = buildGridSvgResult(500);
    const start = performance.now();
    expect(() =>
      assertPngWithinSafeRenderBudget(svgResult.totalWidth, svgResult.totalHeight, 1)
    ).toThrow(PngPerformanceLimitError);
    const durationMs = performance.now() - start;
    console.log(
      `[export-performance][PNG][500 nodes, safe-limit rejection] ${durationMs.toFixed(0)}ms (threshold 100ms, fail-fast check)`
    );
    expect(durationMs).toBeLessThan(100);

    try {
      assertPngWithinSafeRenderBudget(svgResult.totalWidth, svgResult.totalHeight, 1);
    } catch (error) {
      expect((error as Error).message).toMatch(/pdf/i);
    }
  });

  it("rejects a 1,000-node grid organogram PNG request quickly, recommending PDF (Phase 13.1 safe PNG limit)", () => {
    const svgResult = buildGridSvgResult(1000);
    const start = performance.now();
    expect(() =>
      assertPngWithinSafeRenderBudget(svgResult.totalWidth, svgResult.totalHeight, 1)
    ).toThrow(PngPerformanceLimitError);
    const durationMs = performance.now() - start;
    console.log(
      `[export-performance][PNG][1000 nodes, safe-limit rejection] ${durationMs.toFixed(0)}ms (threshold 100ms, fail-fast check)`
    );
    expect(durationMs).toBeLessThan(100);
  });
});

describe("Export performance — PDF rendering at scale", () => {
  it("renders a 100-node grid organogram to PDF (A3, AUTO) within threshold", async () => {
    const svgResult = buildGridSvgResult(100);
    const start = performance.now();
    const result = await renderOrganogramPdf(svgResult, "A3", "AUTO", PDF_METADATA);
    const durationMs = performance.now() - start;
    console.log(
      `[export-performance][PDF][100 nodes] mode=${result.layoutMode} pages=${result.pageCount} -> ${durationMs.toFixed(0)}ms (threshold 1200ms)`
    );
    expect(result.buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(durationMs).toBeLessThan(1200);
  });

  it("renders a 500-node grid organogram to PDF (A3, AUTO, expected MULTI_PAGE_TILED) within threshold", async () => {
    const svgResult = buildGridSvgResult(500);
    const start = performance.now();
    const result = await renderOrganogramPdf(svgResult, "A3", "AUTO", PDF_METADATA);
    const durationMs = performance.now() - start;
    console.log(
      `[export-performance][PDF][500 nodes] mode=${result.layoutMode} pages=${result.pageCount} -> ${durationMs.toFixed(0)}ms (threshold 6000ms)`
    );
    expect(result.buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(result.layoutMode).toBe("MULTI_PAGE_TILED");
    expect(durationMs).toBeLessThan(6000);
  });

  it("rejects a 1,000-node WIDE organogram PDF export quickly (safety guard, not a render-duration budget)", async () => {
    const wide = buildWideSvgResult(1000);
    const start = performance.now();
    await expect(
      renderOrganogramPdf(wide, "A3", "MULTI_PAGE_TILED", PDF_METADATA)
    ).rejects.toBeInstanceOf(PdfPageLimitError);
    const durationMs = performance.now() - start;
    console.log(
      `[export-performance][PDF][1000 wide nodes, rejection] ${durationMs.toFixed(0)}ms (threshold 2000ms, fail-fast check)`
    );
    expect(durationMs).toBeLessThan(2000);
  });
});
