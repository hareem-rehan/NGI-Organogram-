"use client";

import { useMemo, useState, useTransition } from "react";
import type { JobGrade } from "@prisma/client";
import { Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { JOB_GRADE_SCALE } from "@/lib/domain/job-grade-mapping";
import {
  addLevelAction,
  deleteLevelAction,
  getCompanyLevelsAction,
  provisionStandardLevelsAction,
  removeUnusedLevelsAction,
  type JobGradeUsageByCode,
} from "@/app/(app)/settings/actions";

interface LevelsManagerProps {
  initialJobGrades: JobGrade[];
  initialLevelUsageByCode: JobGradeUsageByCode;
}

/**
 * Manages the company-wide seniority scale (job grades) — the levels used by
 * the Position form's Level picker and the organogram's L-badge / "opens at
 * L7+" threshold. Moved here from Career Framework so that page can stay
 * purely about sub-divisions and titles (docs/DECISIONS.md D23). Self-loads
 * and refetches after each change; every mutation is re-authorized
 * (settings:manage) server-side.
 */
export function LevelsManager({ initialJobGrades, initialLevelUsageByCode }: LevelsManagerProps) {
  const [levels, setLevels] = useState(initialJobGrades);
  const [usage, setUsage] = useState(initialLevelUsageByCode);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // One level per code, preferring the shared company-wide grade over any
  // per-department duplicate — exactly the list every Level picker shows.
  const distinctLevels = useMemo(() => {
    const byCode = new Map<string, JobGrade>();
    for (const g of levels) {
      const existing = byCode.get(g.code);
      if (!existing || (existing.departmentId && !g.departmentId)) byCode.set(g.code, g);
    }
    return [...byCode.values()].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  }, [levels]);

  const unusedLevelCount = useMemo(
    () =>
      distinctLevels.filter((g) => {
        const u = usage[g.code];
        return !u || (u.positionCount === 0 && u.titleCount === 0);
      }).length,
    [distinctLevels, usage]
  );

  const addableLevels = useMemo(() => {
    const present = new Set(distinctLevels.map((g) => g.code));
    return JOB_GRADE_SCALE.filter((s) => !present.has(s.code));
  }, [distinctLevels]);

  function refetch() {
    startTransition(async () => {
      const result = await getCompanyLevelsAction();
      if (result.ok) {
        setLevels(result.data.jobGrades);
        setUsage(result.data.levelUsageByCode);
      }
    });
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      refetch();
    });
  }

  return (
    <section className="border-border rounded-lg border p-5" aria-label="Levels">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-foreground text-base font-semibold">Levels</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            The company-wide seniority scale shared by the Position level picker and the organogram.
            Keep only the levels you use — a level in use by a position or a career title can’t be
            removed.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {unusedLevelCount > 0 ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => run(() => removeUnusedLevelsAction())}
            >
              <Trash2 aria-hidden="true" className="size-4" /> Remove {unusedLevelCount} unused
              level
              {unusedLevelCount === 1 ? "" : "s"}
            </Button>
          ) : null}
          {addableLevels.length > 0 ? (
            <Select
              aria-label="Add a level"
              value=""
              disabled={pending}
              onChange={(event) => {
                const code = event.target.value;
                if (code) run(() => addLevelAction({ code }));
              }}
            >
              <option value="">Add a level…</option>
              {addableLevels.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} — {s.name}
                </option>
              ))}
            </Select>
          ) : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-destructive mt-3 text-sm font-medium">
          {error}
        </p>
      ) : null}

      {distinctLevels.length === 0 ? (
        <div className="border-border bg-muted/30 mt-4 flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-foreground text-sm font-medium">No levels set up yet</p>
            <p className="text-muted-foreground mt-0.5 text-sm">
              Add the standard scale (L2–L18) to fill the Position level picker — you can remove the
              ones you don’t use afterwards.
            </p>
          </div>
          <Button
            className="shrink-0"
            disabled={pending}
            onClick={() => run(() => provisionStandardLevelsAction())}
          >
            <Plus aria-hidden="true" className="size-4" /> Set up standard levels
          </Button>
        </div>
      ) : (
        <ul className="mt-4 divide-y">
          {distinctLevels.map((grade) => {
            const u = usage[grade.code] ?? { positionCount: 0, titleCount: 0 };
            const used = u.positionCount > 0 || u.titleCount > 0;
            const usageParts = [
              u.positionCount > 0
                ? `${u.positionCount} position${u.positionCount === 1 ? "" : "s"}`
                : null,
              u.titleCount > 0 ? `${u.titleCount} title${u.titleCount === 1 ? "" : "s"}` : null,
            ].filter(Boolean);
            return (
              <li key={grade.id} className="flex items-center justify-between gap-3 py-2">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="font-medium">{grade.code}</span>
                  {grade.name ? (
                    <span className="text-muted-foreground truncate text-sm">{grade.name}</span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {used ? (
                    <span className="text-muted-foreground text-xs">{usageParts.join(" · ")}</span>
                  ) : (
                    <Badge variant="outline">Unused</Badge>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`Remove level ${grade.code}`}
                    disabled={pending || used}
                    title={
                      used
                        ? "In use — change the positions/titles using it to a different level first"
                        : "Remove this level"
                    }
                    onClick={() => run(() => deleteLevelAction({ code: grade.code }))}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
