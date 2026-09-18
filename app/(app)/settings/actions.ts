"use server";

import type { Company, CompanySettings } from "@prisma/client";

import { requirePermission } from "@/lib/auth/current-user";
import { runAction, type ActionResult } from "@/lib/server/action-result";
import { toAuditActor } from "@/lib/server/audit-actor";
import { findCompanyById } from "@/lib/repositories/company.repository";
import { NotFoundError } from "@/lib/domain/errors";
import {
  getAuthDisplaySettings,
  getOrCreateSettings,
  updateCompanyProfile,
  updateSettings,
  type AuthDisplaySettings,
} from "@/lib/services/settings.service";
import { updateCompanyProfileSchema, updateSettingsSchema } from "@/lib/validation/settings";

export interface SettingsPagePayload {
  company: Company;
  settings: CompanySettings;
  auth: AuthDisplaySettings;
}

export async function getSettingsAction(): Promise<ActionResult<SettingsPagePayload>> {
  return runAction(async () => {
    const user = await requirePermission("settings:manage");
    const company = await findCompanyById(user.companyId);
    if (!company) throw new NotFoundError("Company", user.companyId);
    const settings = await getOrCreateSettings(user.companyId);
    return { company, settings, auth: getAuthDisplaySettings() };
  });
}

export async function updateCompanyProfileAction(input: unknown): Promise<ActionResult<Company>> {
  return runAction(async () => {
    const user = await requirePermission("settings:manage");
    const values = updateCompanyProfileSchema.parse(input);
    return updateCompanyProfile({
      companyId: user.companyId,
      actor: toAuditActor(user),
      ...values,
    });
  });
}

export async function updateSettingsAction(input: unknown): Promise<ActionResult<CompanySettings>> {
  return runAction(async () => {
    const user = await requirePermission("settings:manage");
    const values = updateSettingsSchema.parse(input);
    return updateSettings({ companyId: user.companyId, actor: toAuditActor(user), ...values });
  });
}
