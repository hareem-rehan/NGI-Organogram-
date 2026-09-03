import "server-only";
import PDFDocument from "pdfkit";
// @ts-expect-error — svg-to-pdfkit ships no type declarations.
import SVGtoPDF from "svg-to-pdfkit";

import type { PdfLayoutMode, PdfPageSize } from "./types";
import type { SvgRenderResult } from "./svg-renderer";

export interface PdfRenderMetadata {
  companyName: string;
  scopeLabel: string;
  effectiveDate: string;
  generatedAtLabel: string;
}

export interface PdfRenderResult {
  buffer: Buffer;
  pageCount: number;
  layoutMode: "SINGLE_PAGE" | "MULTI_PAGE_TILED";
}

export class PdfPageLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfPageLimitError";
  }
}

/**
 * A pathologically wide or tall graph (e.g. one manager with hundreds of
 * direct reports) can drive the tile grid into the hundreds of pages.
 * Each tile re-parses the ENTIRE shared SVG string through svg-to-pdfkit
 * (there is no way to hand it only a slice), so an unbounded tile count
 * is a real hang/DoS risk, not just a large-but-usable file — the same
 * "reject or redirect oversized requests" principle `png-renderer.ts`'s
 * `MAX_PNG_DIMENSION_PX`/`MAX_PNG_TOTAL_PIXELS` already enforce for PNG.
 */
export const MAX_PDF_TILE_PAGES = 60;

/** Landscape [width, height] in PDF points (72pt/inch) — A3 landscape is the documented default (docs/ORGANOGRAM_EXPORT_GUIDE.md §"PDF page options"). */
const PAGE_SIZES_PT: Record<PdfPageSize, { width: number; height: number }> = {
  A4: { width: 841.89, height: 595.28 },
  A3: { width: 1190.55, height: 841.89 },
};

const PAGE_MARGIN_PT = 24;
/**
 * Below this fit-to-page scale, AUTO mode switches to multi-page tiling
 * rather than shrinking text past a readable size (Step 4's "avoid
 * shrinking text below the documented minimum readable size" — the
 * smallest text in the SVG is an 8px badge label; at scale 0.5 that
 * renders at 4pt, already at the edge of legibility on paper, so this is
 * the floor rather than going lower).
 */
const MIN_READABLE_SCALE = 0.5;
/** Small overlap between adjacent tiles so a connector crossing a tile boundary is visible on both pages (Step 7's "use a small overlap between adjacent tiles to help navigation"). */
const TILE_OVERLAP_PT = 24;
/** 1 SVG unit = 1 PDF point on detail/tile pages — natural size, the most readable a tile can be. */
const DETAIL_SCALE = 1;

function fitScaleFor(
  svgWidth: number,
  svgHeight: number,
  contentWidth: number,
  contentHeight: number
): number {
  if (svgWidth === 0 || svgHeight === 0) return 1;
  return Math.min(contentWidth / svgWidth, contentHeight / svgHeight);
}

function drawPageFooter(
  doc: PDFKit.PDFDocument,
  page: { width: number; height: number },
  label: string,
  pageLabel: string
) {
  doc
    .fontSize(8)
    .fillColor("#475569")
    .text(label, PAGE_MARGIN_PT, page.height - PAGE_MARGIN_PT + 4, {
      width: page.width - PAGE_MARGIN_PT * 2 - 100,
      align: "left",
    });
  doc
    .fontSize(8)
    .fillColor("#475569")
    .text(pageLabel, page.width - PAGE_MARGIN_PT - 100, page.height - PAGE_MARGIN_PT + 4, {
      width: 100,
      align: "right",
    });
}

/**
 * Converts the shared SVG (docs/adr/0013) into a PDF — a single
 * fit-to-page document for a graph that stays readable, or a multi-page
 * tiled document (an overview page plus detail tiles at natural/1:1
 * scale) for one that wouldn't. Never independently recalculates
 * hierarchy/layout — it only lays the ALREADY-rendered SVG onto pages.
 */
export async function renderOrganogramPdf(
  svgResult: SvgRenderResult,
  pageSize: PdfPageSize,
  layoutMode: PdfLayoutMode,
  metadata: PdfRenderMetadata
): Promise<PdfRenderResult> {
  const page = PAGE_SIZES_PT[pageSize];
  const contentWidth = page.width - PAGE_MARGIN_PT * 2;
  const contentHeight = page.height - PAGE_MARGIN_PT * 2 - 16; // reserve footer strip

  const fitScale = fitScaleFor(
    svgResult.totalWidth,
    svgResult.totalHeight,
    contentWidth,
    contentHeight
  );
  const effectiveMode: "SINGLE_PAGE" | "MULTI_PAGE_TILED" =
    layoutMode === "AUTO"
      ? fitScale >= MIN_READABLE_SCALE
        ? "SINGLE_PAGE"
        : "MULTI_PAGE_TILED"
      : layoutMode;

  const cols =
    effectiveMode === "MULTI_PAGE_TILED"
      ? Math.max(
          1,
          Math.ceil(
            (svgResult.totalWidth * DETAIL_SCALE - TILE_OVERLAP_PT) /
              (contentWidth - TILE_OVERLAP_PT)
          )
        )
      : 1;
  const rows =
    effectiveMode === "MULTI_PAGE_TILED"
      ? Math.max(
          1,
          Math.ceil(
            (svgResult.totalHeight * DETAIL_SCALE - TILE_OVERLAP_PT) /
              (contentHeight - TILE_OVERLAP_PT)
          )
        )
      : 1;
  const totalPages = effectiveMode === "SINGLE_PAGE" ? 1 : 1 + rows * cols; // +1 for the overview page

  if (effectiveMode === "MULTI_PAGE_TILED" && rows * cols > MAX_PDF_TILE_PAGES) {
    throw new PdfPageLimitError(
      `This export would require ${rows * cols} detail pages (${rows} rows × ${cols} columns), which exceeds the maximum of ${MAX_PDF_TILE_PAGES} supported in one PDF. Narrow the scope (a department or position focus), or export as PNG instead.`
    );
  }

  const doc = new PDFDocument({
    size: [page.width, page.height],
    margin: 0,
    autoFirstPage: false,
    info: {
      Title: `${metadata.companyName} Organogram — ${metadata.scopeLabel}`,
      Author: metadata.companyName,
      Subject: `Organogram export, effective ${metadata.effectiveDate}`,
      Creator: "Dynamic Organogram Manager",
      CreationDate: new Date(),
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const endPromise = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  const footerLabel = `${metadata.companyName} · ${metadata.scopeLabel} · Generated ${metadata.generatedAtLabel}`;

  if (effectiveMode === "SINGLE_PAGE") {
    doc.addPage({ size: [page.width, page.height], margin: 0 });
    const renderWidth = svgResult.totalWidth * fitScale;
    const renderHeight = svgResult.totalHeight * fitScale;
    const offsetX = PAGE_MARGIN_PT + (contentWidth - renderWidth) / 2;
    const offsetY = PAGE_MARGIN_PT + (contentHeight - renderHeight) / 2;
    // svg-to-pdfkit's own width/height option does NOT rescale content to
    // fit that box (confirmed empirically) — scaling must be done via
    // pdfkit's own transform stack instead.
    doc.save();
    doc.translate(offsetX, offsetY);
    doc.scale(fitScale);
    SVGtoPDF(doc, svgResult.svg, 0, 0, { assumePt: true });
    doc.restore();
    drawPageFooter(doc, page, footerLabel, "Page 1 of 1");
  } else {
    // Overview page — the whole graph, fit-to-page, same scale logic as SINGLE_PAGE.
    doc.addPage({ size: [page.width, page.height], margin: 0 });
    const overviewWidth = svgResult.totalWidth * fitScale;
    const overviewHeight = svgResult.totalHeight * fitScale;
    const overviewOffsetX = PAGE_MARGIN_PT + (contentWidth - overviewWidth) / 2;
    const overviewOffsetY = PAGE_MARGIN_PT + (contentHeight - overviewHeight) / 2;
    doc.save();
    doc.translate(overviewOffsetX, overviewOffsetY);
    doc.scale(fitScale);
    SVGtoPDF(doc, svgResult.svg, 0, 0, { assumePt: true });
    doc.restore();
    drawPageFooter(doc, page, `${footerLabel} — Overview`, `Page 1 of ${totalPages}`);

    let pageNumber = 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        pageNumber++;
        doc.addPage({ size: [page.width, page.height], margin: 0 });
        const offsetX = PAGE_MARGIN_PT - c * (contentWidth - TILE_OVERLAP_PT) * DETAIL_SCALE;
        const offsetY = PAGE_MARGIN_PT - r * (contentHeight - TILE_OVERLAP_PT) * DETAIL_SCALE;
        doc.save();
        doc.rect(PAGE_MARGIN_PT, PAGE_MARGIN_PT, contentWidth, contentHeight).clip();
        doc.translate(offsetX, offsetY);
        doc.scale(DETAIL_SCALE);
        SVGtoPDF(doc, svgResult.svg, 0, 0, { assumePt: true });
        doc.restore();
        drawPageFooter(
          doc,
          page,
          `${footerLabel} — Tile ${r + 1}-${c + 1} of ${rows}x${cols}`,
          `Page ${pageNumber} of ${totalPages}`
        );
      }
    }
  }

  doc.end();
  const buffer = await endPromise;
  return { buffer, pageCount: totalPages, layoutMode: effectiveMode };
}
