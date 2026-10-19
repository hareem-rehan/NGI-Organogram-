"use server";

import { runAction, type ActionResult } from "@/lib/server/action-result";
import type { DownloadableExport } from "@/app/(app)/organogram/export-actions";
import type { OrganogramChartData } from "@/lib/services/organogram.service";
import { exportSharedChart, getSharedChartData } from "@/lib/services/share-link.service";
import { sharedChartSchema, sharedExportSchema } from "@/lib/validation/share-link";

/**
 * The view-only link's own reads (docs/DECISIONS.md D60). No sign-in: the
 * token in the request IS the authorization, re-checked on every call
 * (unknown, expired and turned-off links all get the same message).
 */

export async function getSharedOrganogramAction(
  input: unknown
): Promise<ActionResult<OrganogramChartData>> {
  return runAction(async () => {
    const { token } = sharedChartSchema.parse(input);
    return getSharedChartData(token);
  });
}

export interface SharedExportFile extends DownloadableExport {
  format: "PDF" | "PNG";
  fileSize: number;
  pageCount: number | null;
  nodeCount: number;
}

export async function exportSharedOrganogramAction(
  input: unknown
): Promise<ActionResult<SharedExportFile>> {
  return runAction(async () => {
    const { token, options } = sharedExportSchema.parse(input);
    const file = await exportSharedChart(token, options);
    return {
      filename: file.filename,
      contentType: file.contentType,
      base64: Buffer.from(file.buffer).toString("base64"),
      format: file.format,
      fileSize: file.buffer.length,
      pageCount: file.pageCount,
      nodeCount: file.nodeCount,
    };
  });
}
