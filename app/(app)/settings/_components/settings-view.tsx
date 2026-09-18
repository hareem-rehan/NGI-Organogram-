"use client";

import { useCallback, useEffect, useState } from "react";
import type { Company, CompanySettings } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingState } from "@/components/patterns/loading-state";
import {
  getSettingsAction,
  updateCompanyProfileAction,
  updateSettingsAction,
  type SettingsPagePayload,
} from "@/app/(app)/settings/actions";

function SavedNotice({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p role="status" className="text-status-filled text-sm font-medium">
      Saved.
    </p>
  );
}

export function SettingsView() {
  const [payload, setPayload] = useState<SettingsPagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // `silent` skips the page-wide loading indicator — used after a
  // successful save, where re-showing <LoadingState> would unmount every
  // section (including the one that just set its own "Saved." notice)
  // before that confirmation is ever visible. The initial mount fetch
  // and the error-state "Retry" button both still want the loading
  // indicator, so only those call this without `silent`.
  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    const result = await getSettingsAction();
    if (!silent) setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPayload(result.data);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const refreshSilently = useCallback(() => refresh(true), [refresh]);

  if (loading) return <LoadingState label="Loading settings…" />;
  if (error || !payload)
    return <ErrorState description={error ?? "Settings unavailable."} onRetry={() => refresh()} />;

  return (
    <div className="flex flex-col gap-8">
      <CompanyProfileSection company={payload.company} onSaved={refreshSilently} />
      <OrganogramDefaultsSection settings={payload.settings} onSaved={refreshSilently} />
      <ExportDefaultsSection settings={payload.settings} onSaved={refreshSilently} />
      <AuthInfoSection auth={payload.auth} />
    </div>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-border rounded-lg border p-5">
      <h2 className="text-foreground text-base font-semibold">{title}</h2>
      {description ? <p className="text-muted-foreground mt-1 text-sm">{description}</p> : null}
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function CompanyProfileSection({ company, onSaved }: { company: Company; onSaved: () => void }) {
  const [name, setName] = useState(company.name);
  const [legalName, setLegalName] = useState(company.legalName ?? "");
  const [timezone, setTimezone] = useState(company.timezone);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setPending(true);
    setError(null);
    setSaved(false);
    const result = await updateCompanyProfileAction({
      name,
      legalName: legalName || null,
      timezone,
      expectedUpdatedAt: company.updatedAt,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(true);
    onSaved();
  }

  return (
    <SectionCard
      title="Company Profile"
      description={`Company code: ${company.code} (read-only after setup).`}
    >
      <Field label="Company name" required>
        {(fieldProps) => (
          <Input {...fieldProps} value={name} onChange={(e) => setName(e.target.value)} />
        )}
      </Field>
      <Field label="Legal name" hint="Optional">
        {(fieldProps) => (
          <Input {...fieldProps} value={legalName} onChange={(e) => setLegalName(e.target.value)} />
        )}
      </Field>
      <Field label="Timezone" hint="A valid IANA timezone, e.g. America/New_York.">
        {(fieldProps) => (
          <Input {...fieldProps} value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        )}
      </Field>
      {error ? (
        <p role="alert" className="text-destructive text-sm font-medium">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="button" onClick={handleSave} disabled={pending || !name.trim()}>
          Save Profile
        </Button>
        <SavedNotice show={saved} />
      </div>
    </SectionCard>
  );
}

function OrganogramDefaultsSection({
  settings,
  onSaved,
}: {
  settings: CompanySettings;
  onSaved: () => void;
}) {
  const [depth, setDepth] = useState(settings.defaultExpansionDepth);
  const [viewMode, setViewMode] = useState(settings.defaultViewMode);
  const [showPlanned, setShowPlanned] = useState(settings.showPlannedByDefault);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setPending(true);
    setError(null);
    setSaved(false);
    const result = await updateSettingsAction({
      defaultExpansionDepth: depth,
      defaultViewMode: viewMode as "visual" | "outline",
      showPlannedByDefault: showPlanned,
      expectedUpdatedAt: settings.updatedAt,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(true);
    onSaved();
  }

  return (
    <SectionCard
      title="Organogram Defaults"
      description="Applied the next time someone opens the organogram."
    >
      <Field
        label="Default expansion depth"
        hint="Levels below the root shown expanded by default (1–10)."
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="number"
            min={1}
            max={10}
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
          />
        )}
      </Field>
      <Field label="Default view">
        {(fieldProps) => (
          <Select {...fieldProps} value={viewMode} onChange={(e) => setViewMode(e.target.value)}>
            <option value="visual">Visual View</option>
            <option value="outline">Outline View</option>
          </Select>
        )}
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-primary size-4"
          checked={showPlanned}
          onChange={(e) => setShowPlanned(e.target.checked)}
        />
        Show planned positions by default
      </label>
      {error ? (
        <p role="alert" className="text-destructive text-sm font-medium">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="button" onClick={handleSave} disabled={pending}>
          Save Organogram Defaults
        </Button>
        <SavedNotice show={saved} />
      </div>
    </SectionCard>
  );
}

function ExportDefaultsSection({
  settings,
  onSaved,
}: {
  settings: CompanySettings;
  onSaved: () => void;
}) {
  const [pageSize, setPageSize] = useState(settings.defaultPdfPageSize);
  const [layoutMode, setLayoutMode] = useState(settings.defaultPdfLayoutMode);
  const [pngScale, setPngScale] = useState(settings.defaultPngScale);
  const [includeLegend, setIncludeLegend] = useState(settings.includeLegendByDefault);
  const [includeConfidentiality, setIncludeConfidentiality] = useState(
    settings.includeConfidentialityLabelByDefault
  );
  const [retentionDays, setRetentionDays] = useState(settings.exportRetentionDays);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setPending(true);
    setError(null);
    setSaved(false);
    const result = await updateSettingsAction({
      defaultPdfPageSize: pageSize as "A4" | "A3",
      defaultPdfLayoutMode: layoutMode as "AUTO" | "SINGLE_PAGE" | "MULTI_PAGE_TILED",
      defaultPngScale: pngScale as 1 | 2 | 3,
      includeLegendByDefault: includeLegend,
      includeConfidentialityLabelByDefault: includeConfidentiality,
      exportRetentionDays: retentionDays,
      expectedUpdatedAt: settings.updatedAt,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(true);
    onSaved();
  }

  return (
    <SectionCard
      title="Export Defaults"
      description="Pre-selected the next time someone opens the Export dialog."
    >
      <Field label="Default PDF page size">
        {(fieldProps) => (
          <Select {...fieldProps} value={pageSize} onChange={(e) => setPageSize(e.target.value)}>
            <option value="A3">A3 landscape</option>
            <option value="A4">A4 landscape</option>
          </Select>
        )}
      </Field>
      <Field label="Default PDF layout">
        {(fieldProps) => (
          <Select
            {...fieldProps}
            value={layoutMode}
            onChange={(e) => setLayoutMode(e.target.value)}
          >
            <option value="AUTO">Auto</option>
            <option value="SINGLE_PAGE">Single page</option>
            <option value="MULTI_PAGE_TILED">Multi-page tiled</option>
          </Select>
        )}
      </Field>
      <Field label="Default PNG scale">
        {(fieldProps) => (
          <Select
            {...fieldProps}
            value={String(pngScale)}
            onChange={(e) => setPngScale(Number(e.target.value))}
          >
            <option value="1">1x</option>
            <option value="2">2x</option>
            <option value="3">3x</option>
          </Select>
        )}
      </Field>
      <Field
        label="Export retention (days)"
        hint="How long a generated file stays downloadable before it expires (1–30)."
      >
        {(fieldProps) => (
          <Input
            {...fieldProps}
            type="number"
            min={1}
            max={30}
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
          />
        )}
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-primary size-4"
          checked={includeLegend}
          onChange={(e) => setIncludeLegend(e.target.checked)}
        />
        Include legend by default
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-primary size-4"
          checked={includeConfidentiality}
          onChange={(e) => setIncludeConfidentiality(e.target.checked)}
        />
        Include &quot;Confidential&quot; label by default
      </label>
      {error ? (
        <p role="alert" className="text-destructive text-sm font-medium">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="button" onClick={handleSave} disabled={pending}>
          Save Export Defaults
        </Button>
        <SavedNotice show={saved} />
      </div>
    </SectionCard>
  );
}

function AuthInfoSection({ auth }: { auth: SettingsPagePayload["auth"] }) {
  return (
    <SectionCard
      title="Company SSO"
      description="Read-only. Provider credentials are configured via environment variables, never in this UI."
    >
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <dt className="text-muted-foreground">Provider</dt>
        <dd>{auth.providerName}</dd>
        <dt className="text-muted-foreground">Allowed email domains</dt>
        <dd>{auth.allowedDomains.join(", ")}</dd>
        <dt className="text-muted-foreground">Auto-provision VIEWERs</dt>
        <dd>{auth.autoProvisionViewersEnabled ? "Enabled" : "Disabled"}</dd>
      </dl>
    </SectionCard>
  );
}
