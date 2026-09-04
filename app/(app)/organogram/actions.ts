"use server";

import { requirePermission } from "@/lib/auth/current-user";
import { runAction, type ActionResult } from "@/lib/server/action-result";
import { getOrganogramData, type OrganogramData } from "@/lib/services/organogram.service";

/**
 * The organogram's only read operation. No parameters accepted — display
 * options (planned-position visibility, expansion depth) are pure
 * client-side UI state over the one full payload this returns, never a
 * server round-trip. `companyId` is derived exclusively from the
 * authenticated session, never from client input.
 */
export async function getOrganogramAction(): Promise<ActionResult<OrganogramData>> {
  return runAction(async () => {
    const user = await requirePermission("organogram:view");
    return getOrganogramData({ companyId: user.companyId });
  });
}
