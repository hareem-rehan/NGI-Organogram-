"use server";

import { requirePermission } from "@/lib/auth/current-user";
import { runAction, type ActionResult } from "@/lib/server/action-result";
import { toAuditActor } from "@/lib/server/audit-actor";
import {
  createShareLink,
  listShareLinks,
  revokeShareLink,
  type ShareLinkSummary,
} from "@/lib/services/share-link.service";
import { createShareLinkSchema, revokeShareLinkSchema } from "@/lib/validation/share-link";

/**
 * Managing view-only organogram links (docs/DECISIONS.md D60): HR editors
 * and admins (`organogram:share`). Re-authorized on every call.
 */

export async function listShareLinksAction(): Promise<ActionResult<ShareLinkSummary[]>> {
  return runAction(async () => {
    const user = await requirePermission("organogram:share");
    return listShareLinks(user.companyId);
  });
}

export async function createShareLinkAction(
  input: unknown
): Promise<ActionResult<ShareLinkSummary>> {
  return runAction(async () => {
    const user = await requirePermission("organogram:share");
    const { label, expiresInDays } = createShareLinkSchema.parse(input);
    return createShareLink({
      companyId: user.companyId,
      actor: toAuditActor(user),
      createdByUserId: user.id,
      label: label ?? null,
      expiresInDays,
    });
  });
}

export async function revokeShareLinkAction(
  input: unknown
): Promise<ActionResult<ShareLinkSummary>> {
  return runAction(async () => {
    const user = await requirePermission("organogram:share");
    const { shareLinkId } = revokeShareLinkSchema.parse(input);
    return revokeShareLink({ companyId: user.companyId, actor: toAuditActor(user), shareLinkId });
  });
}
