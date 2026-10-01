"use server";

import { requirePermission } from "@/lib/auth/current-user";
import { runAction, type ActionResult } from "@/lib/server/action-result";
import {
  getOrganogramChartData,
  type OrganogramChartData,
} from "@/lib/services/organogram.service";
import { toAuditActor } from "@/lib/server/audit-actor";
import {
  clearCardOffsets,
  resetCardOffsets,
  saveCardOffset,
} from "@/lib/services/organogram-layout.service";
import { clearCardOffsetsSchema, saveCardOffsetSchema } from "@/lib/validation/organogram-layout";

/**
 * The organogram's only read operation. No parameters accepted — display
 * options (planned-position visibility, expansion depth) are pure
 * client-side UI state over the one full payload this returns, never a
 * server round-trip. `companyId` is derived exclusively from the
 * authenticated session, never from client input.
 */
export async function getOrganogramAction(): Promise<ActionResult<OrganogramChartData>> {
  return runAction(async () => {
    const user = await requirePermission("organogram:view");
    return getOrganogramChartData({ companyId: user.companyId });
  });
}

/**
 * HR-placed cards (docs/DECISIONS.md D38). Same permission as the rest of
 * Arrange mode; purely visual — never touches a reporting line.
 */
export async function saveCardPositionAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await requirePermission("positions:manage");
    const values = saveCardOffsetSchema.parse(input);
    await saveCardOffset({ companyId: user.companyId, ...values });
    return null;
  });
}

/** Drops the saved spot of cards that were just re-attached elsewhere. */
export async function clearCardPositionsAction(input: unknown): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await requirePermission("positions:manage");
    const { nodeKeys } = clearCardOffsetsSchema.parse(input);
    await clearCardOffsets({ companyId: user.companyId, nodeKeys });
    return null;
  });
}

/** "Reset positions": every card back to the automatic layout. */
export async function resetCardPositionsAction(): Promise<ActionResult<{ cleared: number }>> {
  return runAction(async () => {
    const user = await requirePermission("positions:manage");
    const cleared = await resetCardOffsets({
      companyId: user.companyId,
      actor: toAuditActor(user),
    });
    return { cleared };
  });
}
