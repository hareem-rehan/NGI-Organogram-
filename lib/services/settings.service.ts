import "server-only";
import type { Company, CompanySettings } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { withTransaction } from "@/lib/db/transaction";
import { serverEnv } from "@/lib/env.server";
import { DomainValidationError, NotFoundError, StaleUpdateError } from "@/lib/domain/errors";
import { PDF_LAYOUT_MODES, PDF_PAGE_SIZES, PNG_SCALES } from "@/lib/domain/export/types";
import {
  findCompanyById,
  updateCompanyProfile as updateCompanyProfileRepo,
} from "@/lib/repositories/company.repository";
import {
  createDefaultSettings,
  findSettingsByCompanyId,
  updateSettings as updateSettingsRepo,
} from "@/lib/repositories/settings.repository";
import { recordAuditEvent, type AuditActor } from "@/lib/services/audit.service";

const VIEW_MODES = ["visual", "outline"] as const;
export const MIN_EXPANSION_DEPTH = 1;
export const MAX_EXPANSION_DEPTH = 10;
export const MIN_EXPORT_RETENTION_DAYS = 1;
export const MAX_EXPORT_RETENTION_DAYS = 30;

/**
 * Every Company created before Phase 12 has no `CompanySettings` row —
 * lazily created with safe defaults on first read/write rather than
 * backfilled, since the Prisma-declared column defaults ARE the safe
 * defaults (docs/phase-reports Phase 12's "Settings Storage" section).
 */
export async function getOrCreateSettings(companyId: string): Promise<CompanySettings> {
  const existing = await findSettingsByCompanyId(companyId);
  if (existing) return existing;
  return createDefaultSettings(companyId);
}

export interface UpdateCompanyProfileInput {
  companyId: string;
  actor: AuditActor;
  name?: string;
  legalName?: string | null;
  timezone?: string;
  expectedUpdatedAt?: Date;
}

/** Editable Company-level profile fields only — never `code` (read-only after setup) or `status`. */
export async function updateCompanyProfile(input: UpdateCompanyProfileInput): Promise<Company> {
  return withTransaction(prisma, async (tx) => {
    const existing = await findCompanyById(input.companyId, tx);
    if (!existing) throw new NotFoundError("Company", input.companyId);

    if (
      input.expectedUpdatedAt &&
      existing.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
    ) {
      throw new StaleUpdateError();
    }

    if (input.name !== undefined && input.name.trim().length === 0) {
      throw new DomainValidationError("Company name cannot be empty.");
    }
    if (input.timezone !== undefined) {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: input.timezone });
      } catch {
        throw new DomainValidationError(`"${input.timezone}" is not a valid IANA timezone.`);
      }
    }

    const updated = await updateCompanyProfileRepo(
      input.companyId,
      {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.legalName !== undefined ? { legalName: input.legalName?.trim() || null } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      },
      tx
    );

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor,
        action: "SETTINGS_CHANGED",
        category: "COMPANY_SETTINGS",
        entityType: "Company",
        entityId: updated.id,
        before: existing,
        after: updated,
      },
      tx
    );
    return updated;
  });
}

export interface UpdateSettingsInput {
  companyId: string;
  actor: AuditActor;
  brandingText?: string | null;
  defaultExpansionDepth?: number;
  defaultViewMode?: string;
  showPlannedByDefault?: boolean;
  defaultPdfPageSize?: string;
  defaultPdfLayoutMode?: string;
  defaultPngScale?: number;
  includeLegendByDefault?: boolean;
  includeConfidentialityLabelByDefault?: boolean;
  exportRetentionDays?: number;
  expectedUpdatedAt?: Date;
}

/**
 * Validates every field independently against the exact same constants
 * the export pipeline itself uses (`PDF_PAGE_SIZES`/`PDF_LAYOUT_MODES`/
 * `PNG_SCALES` from `lib/domain/export/types.ts`) — one source of truth,
 * never a duplicated allowlist that could drift. Unknown keys are simply
 * not accepted by this function's typed input (enforced further
 * upstream by the `.strict()` Zod schema at the action layer) — there is
 * no generic JSON blob here for an unknown key to hide in.
 */
export async function updateSettings(input: UpdateSettingsInput): Promise<CompanySettings> {
  if (input.defaultViewMode !== undefined && !VIEW_MODES.includes(input.defaultViewMode as never)) {
    throw new DomainValidationError(`defaultViewMode must be one of: ${VIEW_MODES.join(", ")}.`);
  }
  if (
    input.defaultExpansionDepth !== undefined &&
    (!Number.isInteger(input.defaultExpansionDepth) ||
      input.defaultExpansionDepth < MIN_EXPANSION_DEPTH ||
      input.defaultExpansionDepth > MAX_EXPANSION_DEPTH)
  ) {
    throw new DomainValidationError(
      `defaultExpansionDepth must be an integer between ${MIN_EXPANSION_DEPTH} and ${MAX_EXPANSION_DEPTH}.`
    );
  }
  if (
    input.defaultPdfPageSize !== undefined &&
    !PDF_PAGE_SIZES.includes(input.defaultPdfPageSize as never)
  ) {
    throw new DomainValidationError(
      `defaultPdfPageSize must be one of: ${PDF_PAGE_SIZES.join(", ")}.`
    );
  }
  if (
    input.defaultPdfLayoutMode !== undefined &&
    !PDF_LAYOUT_MODES.includes(input.defaultPdfLayoutMode as never)
  ) {
    throw new DomainValidationError(
      `defaultPdfLayoutMode must be one of: ${PDF_LAYOUT_MODES.join(", ")}.`
    );
  }
  if (input.defaultPngScale !== undefined && !PNG_SCALES.includes(input.defaultPngScale as never)) {
    throw new DomainValidationError(`defaultPngScale must be one of: ${PNG_SCALES.join(", ")}.`);
  }
  if (
    input.exportRetentionDays !== undefined &&
    (!Number.isInteger(input.exportRetentionDays) ||
      input.exportRetentionDays < MIN_EXPORT_RETENTION_DAYS ||
      input.exportRetentionDays > MAX_EXPORT_RETENTION_DAYS)
  ) {
    throw new DomainValidationError(
      `exportRetentionDays must be an integer between ${MIN_EXPORT_RETENTION_DAYS} and ${MAX_EXPORT_RETENTION_DAYS}.`
    );
  }
  if (
    input.brandingText !== undefined &&
    input.brandingText !== null &&
    input.brandingText.length > 200
  ) {
    throw new DomainValidationError("brandingText must be 200 characters or fewer.");
  }

  return withTransaction(prisma, async (tx) => {
    const existing = await getOrCreateSettingsInTx(input.companyId, tx);

    if (
      input.expectedUpdatedAt &&
      existing.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
    ) {
      throw new StaleUpdateError();
    }

    const updated = await updateSettingsRepo(
      input.companyId,
      {
        ...(input.brandingText !== undefined
          ? { brandingText: input.brandingText?.trim() || null }
          : {}),
        ...(input.defaultExpansionDepth !== undefined
          ? { defaultExpansionDepth: input.defaultExpansionDepth }
          : {}),
        ...(input.defaultViewMode !== undefined ? { defaultViewMode: input.defaultViewMode } : {}),
        ...(input.showPlannedByDefault !== undefined
          ? { showPlannedByDefault: input.showPlannedByDefault }
          : {}),
        ...(input.defaultPdfPageSize !== undefined
          ? { defaultPdfPageSize: input.defaultPdfPageSize }
          : {}),
        ...(input.defaultPdfLayoutMode !== undefined
          ? { defaultPdfLayoutMode: input.defaultPdfLayoutMode }
          : {}),
        ...(input.defaultPngScale !== undefined ? { defaultPngScale: input.defaultPngScale } : {}),
        ...(input.includeLegendByDefault !== undefined
          ? { includeLegendByDefault: input.includeLegendByDefault }
          : {}),
        ...(input.includeConfidentialityLabelByDefault !== undefined
          ? { includeConfidentialityLabelByDefault: input.includeConfidentialityLabelByDefault }
          : {}),
        ...(input.exportRetentionDays !== undefined
          ? { exportRetentionDays: input.exportRetentionDays }
          : {}),
      },
      tx
    );

    await recordAuditEvent(
      {
        companyId: input.companyId,
        actor: input.actor,
        action: "SETTINGS_CHANGED",
        category: "COMPANY_SETTINGS",
        entityType: "CompanySettings",
        entityId: updated.id,
        before: existing,
        after: updated,
      },
      tx
    );
    return updated;
  });
}

async function getOrCreateSettingsInTx(
  companyId: string,
  tx: Parameters<typeof findSettingsByCompanyId>[1]
): Promise<CompanySettings> {
  const existing = await findSettingsByCompanyId(companyId, tx);
  if (existing) return existing;
  return createDefaultSettings(companyId, tx);
}

export interface AuthDisplaySettings {
  providerName: string;
  allowedDomains: readonly string[];
  autoProvisionViewersEnabled: boolean;
}

/**
 * Read-only. Deliberately excludes client secret, access/refresh/id
 * token, AUTH_SECRET, and full issuer configuration (Step 16E) — no
 * function anywhere in this module accepts a client secret/token as
 * input, so there is no code path for one to be echoed back even by
 * accident.
 */
export function getAuthDisplaySettings(): AuthDisplaySettings {
  return {
    providerName: serverEnv.AUTH_PROVIDER_NAME,
    allowedDomains: serverEnv.AUTH_ALLOWED_EMAIL_DOMAINS,
    autoProvisionViewersEnabled: serverEnv.AUTH_AUTO_PROVISION_VIEWERS,
  };
}
