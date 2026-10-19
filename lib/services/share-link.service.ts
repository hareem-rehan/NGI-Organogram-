import "server-only";
import { randomBytes } from "node:crypto";
import type { OrganogramShareLink } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors";
import { DomainValidationError, NotFoundError } from "@/lib/domain/errors";
import type { ExportOptionsInput } from "@/lib/domain/export/types";
import type { OrganogramNode } from "@/lib/domain/organogram";
import type { DbClient } from "@/lib/repositories/types";
import { recordAuditEvent, type AuditActor } from "@/lib/services/audit.service";
import { renderExportForCompany, type RenderedExportFile } from "@/lib/services/export.service";
import {
  getOrganogramChartData,
  type OrganogramChartData,
} from "@/lib/services/organogram.service";

/**
 * View-only organogram links (docs/DECISIONS.md D60). Anyone with a link's
 * URL can open the chart without signing in, until it expires or HR turns
 * it off. The token is the whole credential, so every viewer request
 * re-resolves it here — there is no session to trust instead.
 */

/** How long a new link lasts, in days; null = until turned off. */
export type ShareLinkExpiry = 7 | 30 | null;

/** Viewer exports from one link are at most one per this many seconds. */
export const SHARE_EXPORT_COOLDOWN_SECONDS = 15;

/** One message for an unknown, expired or turned-off link: never reveal which. */
export class ShareLinkUnavailableError extends AppError {
  constructor() {
    super("This link has expired or been turned off. Ask the person who shared it for a new one.");
    this.name = "ShareLinkUnavailableError";
  }
}

export type ShareLinkStatus = "active" | "expired" | "off";

export interface ShareLinkSummary {
  id: string;
  token: string;
  label: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  status: ShareLinkStatus;
}

export function shareLinkStatus(
  link: Pick<OrganogramShareLink, "expiresAt" | "revokedAt">,
  now: Date = new Date()
): ShareLinkStatus {
  if (link.revokedAt) return "off";
  if (link.expiresAt && link.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}

function toSummary(link: OrganogramShareLink, now: Date): ShareLinkSummary {
  return {
    id: link.id,
    token: link.token,
    label: link.label,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    status: shareLinkStatus(link, now),
  };
}

/** 32 random bytes, URL-safe: unguessable, and fits in a link as-is. */
export function generateShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createShareLink(
  input: {
    companyId: string;
    actor?: AuditActor;
    createdByUserId?: string | null;
    label?: string | null;
    expiresInDays: ShareLinkExpiry;
  },
  db: DbClient = prisma
): Promise<ShareLinkSummary> {
  const now = new Date();
  const link = await db.organogramShareLink.create({
    data: {
      companyId: input.companyId,
      token: generateShareToken(),
      label: input.label?.trim() || null,
      createdByUserId: input.createdByUserId ?? null,
      expiresAt:
        input.expiresInDays === null
          ? null
          : new Date(now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000),
    },
  });
  await recordAuditEvent(
    {
      companyId: input.companyId,
      actor: input.actor ?? "SYSTEM",
      action: "CREATED",
      category: "SECURITY",
      entityType: "OrganogramShareLink",
      entityId: link.id,
      entityDisplayReference: link.label ?? "View-only organogram link",
      // Never the token itself: the audit log is readable by more people
      // than should be able to open the link.
      after: { label: link.label, expiresAt: link.expiresAt },
    },
    db
  );
  return toSummary(link, now);
}

export async function listShareLinks(
  companyId: string,
  db: DbClient = prisma
): Promise<ShareLinkSummary[]> {
  const now = new Date();
  const links = await db.organogramShareLink.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
  });
  return links.map((link) => toSummary(link, now));
}

/** Turns a link off for good. Turning off an already-off link changes nothing. */
export async function revokeShareLink(
  input: { companyId: string; actor?: AuditActor; shareLinkId: string },
  db: DbClient = prisma
): Promise<ShareLinkSummary> {
  const link = await db.organogramShareLink.findFirst({
    where: { id: input.shareLinkId, companyId: input.companyId },
  });
  if (!link) throw new NotFoundError("Share link", input.shareLinkId);
  if (link.revokedAt) return toSummary(link, new Date());

  const revoked = await db.organogramShareLink.update({
    where: { id: link.id },
    data: { revokedAt: new Date() },
  });
  await recordAuditEvent(
    {
      companyId: input.companyId,
      actor: input.actor ?? "SYSTEM",
      action: "UPDATED",
      category: "SECURITY",
      entityType: "OrganogramShareLink",
      entityId: link.id,
      entityDisplayReference: link.label ?? "View-only organogram link",
      before: { revokedAt: null },
      after: { revokedAt: revoked.revokedAt },
      metadata: { turnedOff: true },
    },
    db
  );
  return toSummary(revoked, new Date());
}

/** The active link behind a token, or ShareLinkUnavailableError. */
export async function resolveShareLink(
  token: string,
  db: DbClient = prisma,
  now: Date = new Date()
): Promise<OrganogramShareLink> {
  const link = await db.organogramShareLink.findUnique({ where: { token } });
  if (!link || shareLinkStatus(link, now) !== "active") throw new ShareLinkUnavailableError();
  return link;
}

/**
 * What a link viewer may see: the chart exactly as signed-in users see it,
 * minus anything that points at an employee record (viewers have no access
 * to employee pages). Names, titles, departments and levels stay — they are
 * the chart.
 */
export function toViewerChartData(data: OrganogramChartData): OrganogramChartData {
  const stripNode = (node: OrganogramNode): OrganogramNode => ({
    ...node,
    occupantEmployeeId: null,
    occupantEmployeeIds: [],
  });
  return { ...data, nodes: data.nodes.map(stripNode) };
}

export async function getSharedChartData(token: string): Promise<OrganogramChartData> {
  const link = await resolveShareLink(token);
  return toViewerChartData(await getOrganogramChartData({ companyId: link.companyId }));
}

/**
 * A viewer's PDF/PNG export. Throttled per link (one every
 * SHARE_EXPORT_COOLDOWN_SECONDS) with a single conditional update, so two
 * requests at once can't both pass — a public link must not be able to
 * keep the server busy rendering.
 */
export async function exportSharedChart(
  token: string,
  options: ExportOptionsInput,
  db: DbClient = prisma
): Promise<RenderedExportFile & { nodeCount: number }> {
  const now = new Date();
  const link = await resolveShareLink(token, db, now);
  const cutoff = new Date(now.getTime() - SHARE_EXPORT_COOLDOWN_SECONDS * 1000);
  const claimed = await db.organogramShareLink.updateMany({
    where: { id: link.id, OR: [{ lastExportAt: null }, { lastExportAt: { lt: cutoff } }] },
    data: { lastExportAt: now },
  });
  if (claimed.count === 0) {
    throw new DomainValidationError(
      `Please wait ${SHARE_EXPORT_COOLDOWN_SECONDS} seconds between downloads.`
    );
  }

  const file = await renderExportForCompany(link.companyId, options);
  await recordAuditEvent(
    {
      companyId: link.companyId,
      actor: "SYSTEM",
      action: "EXPORT_COMPLETED",
      category: "EXPORT",
      entityType: "OrganogramShareLink",
      entityId: link.id,
      entityDisplayReference: link.label ?? "View-only organogram link",
      metadata: {
        viaShareLink: true,
        format: file.format,
        fileSize: file.buffer.length,
        nodeCount: file.nodeCount,
      },
    },
    db
  );
  return file;
}
