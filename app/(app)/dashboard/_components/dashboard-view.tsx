"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Plus, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingState } from "@/components/patterns/loading-state";
import { getDashboardAction } from "@/app/(app)/dashboard/actions";
import type { DashboardSummary } from "@/lib/services/dashboard.service";

interface DashboardViewProps {
  canManage: boolean;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function SummaryCard({
  label,
  value,
  href,
  hint,
}: {
  label: string;
  value: number | string;
  href?: string;
  hint?: string;
}) {
  // Not a `<dl>`/`<dt>`/`<dd>` — a grid of clickable stat cards isn't a
  // definition list, and the HTML content model for `<dl>` doesn't
  // permit an `<a>` alongside dt/dd at any nesting depth. An earlier
  // version tried both "wrap the pair in an `<a>`" and "stretched link
  // as a third sibling inside a dl>div" — axe's definition-list rule
  // flagged both (intermittently, only when a card with data was
  // actually scanned — see docs/DECISIONS.md A27). Plain `<p>` elements
  // avoid the whole problem class.
  return (
    <div className="border-border bg-background hover:border-foreground/20 relative flex flex-col gap-1 rounded-lg border p-4 transition-colors">
      <p className="text-muted-foreground text-sm font-medium">{label}</p>
      <p className="text-foreground text-2xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      {href ? (
        <Link
          href={href}
          aria-label={`${label}: ${value}`}
          className="focus-visible:ring-ring absolute inset-0 rounded-lg focus-visible:ring-2 focus-visible:outline-none"
        />
      ) : null}
    </div>
  );
}

export function DashboardView({ canManage }: DashboardViewProps) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    void (async () => {
      const result = await getDashboardAction();
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSummary(result.data);
    })();
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  if (loading) return <LoadingState label="Loading dashboard…" />;
  if (error || !summary)
    return <ErrorState description={error ?? "Dashboard unavailable."} onRetry={refresh} />;

  const {
    company,
    departments,
    positions,
    employees,
    vacancyRate,
    departmentSummaries,
    warnings,
    sectionErrors,
  } = summary;

  const noRootYet = positions.root === null;

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="dashboard-company-heading" className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="dashboard-company-heading" className="text-foreground text-lg font-semibold">
              {company.name}{" "}
              <span className="text-muted-foreground font-normal">({company.code})</span>
            </h2>
            <p className="text-muted-foreground text-sm">
              Effective date {company.effectiveDate} · Timezone {company.timezone}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-muted-foreground text-xs">
              Last refreshed {formatDateTime(company.lastRefreshed)}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={refresh}>
              <RefreshCw aria-hidden="true" className="size-4" />
              Refresh
            </Button>
          </div>
        </div>
      </section>

      {noRootYet ? (
        <section
          role="status"
          className="border-border bg-muted flex flex-col items-start gap-2 rounded-lg border border-dashed p-6"
        >
          <p className="text-foreground text-sm font-medium">No root position yet</p>
          <p className="text-muted-foreground text-sm">
            {canManage
              ? "Create the first position to begin your organization chart."
              : "This company's organization chart has not been set up yet."}
          </p>
          {canManage ? (
            <Button asChild size="sm" className="mt-1">
              <Link href="/positions">
                <Plus aria-hidden="true" className="size-4" />
                Add Position
              </Link>
            </Button>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="dashboard-summary-heading">
        <h2 id="dashboard-summary-heading" className="text-foreground mb-3 text-base font-semibold">
          Summary
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <SummaryCard
            label="Active Employees"
            value={employees.active}
            href="/employees?status=ACTIVE"
          />
          <SummaryCard
            label="Active Positions"
            value={positions.totalActive}
            href="/positions?status=ACTIVE"
          />
          <SummaryCard label="Occupied Positions" value={positions.occupied} />
          <SummaryCard
            label="Vacant Positions"
            value={positions.vacant}
            href="/positions?status=ACTIVE&occupancy=vacant"
          />
          <SummaryCard
            label="Planned Positions"
            value={positions.planned}
            href="/positions?status=PLANNED"
          />
          <SummaryCard
            label="Active Departments"
            value={departments.totalActive}
            href="/departments?status=ACTIVE"
          />
        </div>
      </section>

      <section aria-labelledby="dashboard-structure-heading">
        <h2
          id="dashboard-structure-heading"
          className="text-foreground mb-3 text-base font-semibold"
        >
          Organizational structure
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="border-border rounded-lg border p-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Root position</dt>
              <dd>
                {positions.root ? (
                  <>
                    {positions.root.title}{" "}
                    <Badge variant={positions.root.isActive ? "success" : "muted"}>
                      {positions.root.status}
                    </Badge>
                  </>
                ) : (
                  <span className="text-muted-foreground">— none yet</span>
                )}
              </dd>
              <dt className="text-muted-foreground">Maximum level</dt>
              <dd>{positions.maxLevel ?? "—"}</dd>
              <dt className="text-muted-foreground">Assigned vs. unassigned employees</dt>
              <dd>
                {employees.activeAssigned} assigned ·{" "}
                <Link href="/employees?assignment=unassigned" className="underline">
                  {employees.activeUnassigned} unassigned
                </Link>
              </dd>
            </dl>
          </div>
          <div className="border-border rounded-lg border p-4">
            <h3 className="text-foreground mb-2 text-sm font-medium">Active positions by level</h3>
            {positions.levelDistribution.length === 0 ? (
              <p className="text-muted-foreground text-sm">No active positions yet.</p>
            ) : (
              <table className="w-full text-sm">
                <caption className="sr-only">Active positions by organizational level</caption>
                <thead className="text-muted-foreground">
                  <tr>
                    <th scope="col" className="text-left font-medium">
                      Level
                    </th>
                    <th scope="col" className="text-left font-medium">
                      Count
                    </th>
                    <th scope="col" className="w-full text-left font-medium">
                      <span className="sr-only">Proportion</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {positions.levelDistribution.map((row) => (
                    <tr key={row.level}>
                      <td className="py-1 pr-3">{row.level}</td>
                      <td className="py-1 pr-3">{row.count}</td>
                      <td className="py-1">
                        <div
                          className="bg-primary/70 h-2 rounded-full"
                          style={{
                            width: `${Math.max(4, Math.round((row.count / (positions.totalActive || 1)) * 100))}%`,
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="dashboard-vacancy-heading">
        <h2 id="dashboard-vacancy-heading" className="text-foreground mb-3 text-base font-semibold">
          Vacancy overview
        </h2>
        <div className="border-border rounded-lg border p-4">
          <p className="text-foreground text-sm">
            <span className="text-2xl font-semibold">
              {vacancyRate.percent === null ? "—" : `${vacancyRate.percent}%`}
            </span>{" "}
            <span className="text-muted-foreground">
              ({vacancyRate.vacantCount} of {vacancyRate.eligibleCount} eligible active position
              {vacancyRate.eligibleCount === 1 ? "" : "s"} vacant)
            </span>
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            Eligible active positions are Active positions in an Active department. Planned and
            Inactive positions are never counted.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link href="/positions?status=ACTIVE&occupancy=vacant">View vacant positions</Link>
          </Button>
        </div>
      </section>

      <section aria-labelledby="dashboard-departments-heading">
        <h2
          id="dashboard-departments-heading"
          className="text-foreground mb-3 text-base font-semibold"
        >
          Departments
        </h2>
        {sectionErrors.departmentSummaries ? (
          <p role="alert" className="text-destructive text-sm">
            This section is temporarily unavailable.
          </p>
        ) : departmentSummaries === null || departmentSummaries.length === 0 ? (
          <p className="text-muted-foreground text-sm">No departments yet.</p>
        ) : (
          <div className="border-border overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <caption className="sr-only">Department summary</caption>
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Department
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Active
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Occupied
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Vacant
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Planned
                  </th>
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Max level
                  </th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {departmentSummaries.map((dept) => (
                  <tr key={dept.id}>
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="border-border inline-block size-2.5 shrink-0 rounded-full border"
                          style={{ backgroundColor: dept.color ?? "transparent" }}
                        />
                        <Link
                          href={`/positions?department=${encodeURIComponent(dept.id)}`}
                          className="hover:underline focus-visible:underline"
                        >
                          {dept.name}
                        </Link>{" "}
                        <span className="text-muted-foreground">({dept.code})</span>
                        {dept.status === "INACTIVE" ? (
                          <Badge variant="muted">Inactive</Badge>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-4 py-2">{dept.activePositionCount}</td>
                    <td className="px-4 py-2">{dept.occupiedPositionCount}</td>
                    <td className="px-4 py-2">{dept.vacantPositionCount}</td>
                    <td className="px-4 py-2">{dept.plannedPositionCount}</td>
                    <td className="px-4 py-2">{dept.maxOrganizationalLevel ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManage ? (
        <section aria-labelledby="dashboard-warnings-heading">
          <h2
            id="dashboard-warnings-heading"
            className="text-foreground mb-3 text-base font-semibold"
          >
            Data quality
          </h2>
          {sectionErrors.warnings ? (
            <p role="alert" className="text-destructive text-sm">
              This section is temporarily unavailable.
            </p>
          ) : !warnings || warnings.length === 0 ? (
            <p className="text-muted-foreground text-sm">No structural issues detected.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {warnings.map((warning) => (
                <li
                  key={warning.id}
                  className="border-status-planned/40 bg-status-planned/5 flex items-start gap-3 rounded-lg border p-3"
                >
                  <AlertTriangle
                    aria-hidden="true"
                    className="text-status-planned-foreground mt-0.5 size-4 shrink-0"
                  />
                  <div className="flex-1">
                    <p className="text-foreground text-sm font-medium">
                      {warning.title} <Badge variant="warning">{warning.count}</Badge>
                    </p>
                    <p className="text-muted-foreground text-sm">{warning.description}</p>
                    {warning.link ? (
                      <Link href={warning.link.href} className="text-sm underline">
                        {warning.link.label}
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section aria-labelledby="dashboard-actions-heading">
        <h2 id="dashboard-actions-heading" className="text-foreground mb-3 text-base font-semibold">
          Quick actions
        </h2>
        <div className="flex flex-wrap gap-2">
          {canManage ? (
            <>
              <Button asChild variant="outline" size="sm">
                <Link href="/departments">
                  <Plus aria-hidden="true" className="size-4" />
                  Add Department
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/positions">
                  <Plus aria-hidden="true" className="size-4" />
                  Add Position
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/employees">
                  <Plus aria-hidden="true" className="size-4" />
                  Add Employee
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/employees">Assign Employee</Link>
              </Button>
            </>
          ) : (
            <>
              <Button asChild variant="outline" size="sm">
                <Link href="/departments">View Departments</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/positions">View Positions</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/employees">View Employees</Link>
              </Button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
