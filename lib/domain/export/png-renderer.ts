import "server-only";
import sharp from "sharp";

import { MAX_PNG_DIMENSION_PX, MAX_PNG_TOTAL_PIXELS, type PngScale } from "./types";

export class PngSizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PngSizeError";
  }
}

/**
 * A materially TIGHTER, performance-driven ceiling than
 * `MAX_PNG_DIMENSION_PX`/`MAX_PNG_TOTAL_PIXELS` above (which exist purely
 * to prevent unbounded memory use for a pathological request — DEF-010
 * measured real renders completing, just far too slowly, well below
 * those limits). Calibrated from real measured durations (Phase 13.1,
 * DEF-010 remediation — see docs/PERFORMANCE_REPORT.md and
 * docs/phase-reports/PHASE_13_1_PERFORMANCE_REMEDIATION.md for the full
 * benchmark table): a 250-node grid organogram (~19.7 megapixels at 1x
 * scale) rendered in ~1.4s isolated; 300 nodes (~23.4 megapixels) rose to
 * ~2.9s isolated, which DEF-010's own full-suite-load multiplier
 * (observed ~1.3-2x the isolated duration) could push past a safe
 * interactive-request budget. 20,000,000 total pixels sits with headroom
 * below the 300-node data point, keeping every request this limit allows
 * comfortably inside that budget even under load.
 */
export const MAX_PNG_SAFE_TOTAL_PIXELS = 20_000_000;

export class PngPerformanceLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PngPerformanceLimitError";
  }
}

/**
 * Checked by `export.service.ts` BEFORE an `ExportJob` row is even
 * created, so a PNG request already known to exceed the safe render-time
 * budget is never queued at all (Step 9.6) — distinct from
 * `renderSvgToPng`'s own `MAX_PNG_DIMENSION_PX`/`MAX_PNG_TOTAL_PIXELS`
 * checks below, which remain as a final, much looser memory-safety
 * backstop immediately before rasterization.
 */
export function assertPngWithinSafeRenderBudget(
  baseWidth: number,
  baseHeight: number,
  scale: PngScale
): void {
  const width = Math.round(baseWidth * scale);
  const height = Math.round(baseHeight * scale);
  const totalPixels = width * height;
  if (totalPixels > MAX_PNG_SAFE_TOTAL_PIXELS) {
    throw new PngPerformanceLimitError(
      `This organogram is too large to render as PNG at this scale (${width}x${height}px, ${(
        totalPixels / 1_000_000
      ).toFixed(
        1
      )} megapixels) within a reasonable time. Export as PDF instead — PDF supports this scale via multi-page tiling — or choose a lower PNG scale, or narrow the scope (a department or position focus).`
    );
  }
}

export interface PngRenderResult {
  buffer: Buffer;
  width: number;
  height: number;
}

/**
 * Rasterizes the shared SVG (never a viewport-only crop — the SVG
 * already contains the complete authorized subgraph) to a PNG at the
 * requested scale. `density: 72 * scale` rasterizes AT the target
 * resolution directly (verified empirically — `density: 72` reproduces
 * the SVG's own declared pixel dimensions exactly), so text/shapes stay
 * crisp at 2×/3× rather than being blurrily upscaled after the fact.
 *
 * Rejects (never silently produces a blank/corrupt file) when the
 * requested output would exceed `MAX_PNG_DIMENSION_PX` or
 * `MAX_PNG_TOTAL_PIXELS` — Step 8's "reject or redirect oversized
 * requests to PDF."
 */
export async function renderSvgToPng(
  svg: string,
  baseWidth: number,
  baseHeight: number,
  scale: PngScale
): Promise<PngRenderResult> {
  const width = Math.round(baseWidth * scale);
  const height = Math.round(baseHeight * scale);

  if (width > MAX_PNG_DIMENSION_PX || height > MAX_PNG_DIMENSION_PX) {
    throw new PngSizeError(
      `The requested PNG (${width}x${height}px) exceeds the maximum supported dimension of ${MAX_PNG_DIMENSION_PX}px. Use a lower scale or export as PDF instead.`
    );
  }
  if (width * height > MAX_PNG_TOTAL_PIXELS) {
    throw new PngSizeError(
      `The requested PNG (${width}x${height}px, ${(width * height).toLocaleString()} pixels) exceeds the maximum supported pixel count of ${MAX_PNG_TOTAL_PIXELS.toLocaleString()}. Use a lower scale or export as PDF instead.`
    );
  }

  const buffer = await sharp(Buffer.from(svg, "utf-8"), { density: 72 * scale })
    .png()
    .toBuffer();

  return { buffer, width, height };
}
