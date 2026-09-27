"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { Department, JobFamily } from "@prisma/client";
import { Plus, Trash2, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  deleteJobFamilyAction,
  getCareerFrameworkAction,
} from "@/app/(app)/career-framework/actions";
import { JobFamilyDialog } from "./job-family-dialog";

interface CareerFrameworkViewProps {
  canManage: boolean;
  initialJobFamilies: JobFamily[];
  departments: Department[];
}

export function CareerFrameworkView({
  canManage,
  initialJobFamilies,
  departments,
}: CareerFrameworkViewProps) {
  const [jobFamilies, setJobFamilies] = useState(initialJobFamilies);
  const [actionError, setActionError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [familyDialogOpen, setFamilyDialogOpen] = useState(false);
  const [editingFamily, setEditingFamily] = useState<JobFamily | null>(null);

  const departmentsById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);

  function refetch() {
    startTransition(async () => {
      const result = await getCareerFrameworkAction();
      if (result.ok) setJobFamilies(result.data.jobFamilies);
    });
  }

  function runManage(action: () => Promise<{ ok: boolean; error?: string }>) {
    setActionError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setActionError(result.error ?? "Something went wrong.");
        return;
      }
      refetch();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground max-w-2xl text-sm">
          Sub-divisions are career specializations (e.g. UI/UX, QA) within a department. They group
          positions on the organogram and describe career progression — they never set who reports
          to whom. Level names are configured on the{" "}
          <Link href="/levels-mapping" className="underline">
            Levels Mapping
          </Link>{" "}
          page.
        </p>
        {canManage ? (
          <Button
            onClick={() => {
              setEditingFamily(null);
              setFamilyDialogOpen(true);
            }}
          >
            <Plus aria-hidden="true" className="size-4" /> Add Sub-division
          </Button>
        ) : null}
      </div>

      {actionError ? (
        <p role="alert" className="text-destructive text-sm font-medium">
          {actionError}
        </p>
      ) : null}

      {jobFamilies.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          No sub-divisions yet. {canManage ? "Add one to start grouping positions." : ""}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {jobFamilies.map((family) => {
            const department = departmentsById.get(family.departmentId);
            return (
              <li
                key={family.id}
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-4"
                aria-label={`Sub-division ${family.name}`}
              >
                <div>
                  <h2 className="text-base font-semibold">{family.name}</h2>
                  <p className="text-muted-foreground text-xs">
                    {department ? department.name : "—"} · {family.code}
                  </p>
                  {family.description ? (
                    <p className="text-muted-foreground mt-1 text-sm">{family.description}</p>
                  ) : null}
                </div>
                {canManage ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Edit ${family.name}`}
                      onClick={() => {
                        setEditingFamily(family);
                        setFamilyDialogOpen(true);
                      }}
                    >
                      <Pencil aria-hidden="true" className="size-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      aria-label={`Delete ${family.name}`}
                      onClick={() =>
                        runManage(() => deleteJobFamilyAction({ jobFamilyId: family.id }))
                      }
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {canManage ? (
        <JobFamilyDialog
          open={familyDialogOpen}
          onOpenChange={setFamilyDialogOpen}
          jobFamily={editingFamily}
          departments={departments}
          onSaved={refetch}
        />
      ) : null}
    </div>
  );
}
