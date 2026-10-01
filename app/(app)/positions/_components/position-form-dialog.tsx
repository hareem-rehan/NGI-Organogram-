"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import type { CareerTrack, Department, JobFamily, JobGrade, Position } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { JOB_GRADE_SCALE } from "@/lib/domain/job-grade-mapping";
import {
  levelNameFor,
  type LevelTitleInput,
  type SubDivisionLevelTitleInput,
} from "@/lib/domain/level-labels";
import {
  createPositionAction,
  getPositionOccupantAction,
  listEmployeeOptionsAction,
  setPositionOccupantAction,
  updatePositionAction,
} from "@/app/(app)/positions/actions";
import type { EmployeeOption } from "@/lib/repositories/employee.repository";

interface PositionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: Position | null;
  departments: readonly Department[];
  jobGrades: readonly JobGrade[];
  jobFamilies: readonly JobFamily[];
  careerTracks: readonly CareerTrack[];
  /** Only relevant when creating (used to populate the Reports-To combobox and to detect whether a root already exists). */
  allPositions: readonly Position[];
  /**
   * Create-mode prefill (ignored when editing). Used by the organogram's
   * "add a direct report" action to open the form already scoped to the
   * parent's department and reporting to it. Both still fully editable.
   */
  initialDepartmentId?: string | null;
  initialReportsToPositionId?: string | null;
  /** Create-mode prefill for the sub-division (+ on an organogram card or sub-division box). */
  initialJobFamilyId?: string | null;
  /** Each department's own level names from Levels Mapping (D32). Optional: absent → standard names. */
  levelTitles?: readonly LevelTitleInput[];
  /** Sub-division level names (D34); preferred when a sub-division is chosen. */
  subDivisionLevelTitles?: readonly SubDivisionLevelTitleInput[];
  onSaved: () => void;
}

interface FormValues {
  title: string;
  departmentId: string;
  jobFamilyId: string | null;
  /** Plain IC/Manager choice; resolved to a track (created if needed) on submit. */
  careerTrackKind: "IC" | "MANAGER" | null;
  /**
   * The chosen level CODE (e.g. "L7"), from the full standard scale — not a
   * grade id. The action resolves it to a job grade for the department,
   * creating the grade on first use, so the picker can offer every level even
   * when the company hasn't set them all up. Null = no level.
   */
  jobGradeCode: string | null;
  description: string | null;
  primaryReportsToPositionId: string | null;
}

/**
 * The managers a new position may report to. Once a department is chosen,
 * the picker hides positions from OTHER departments — with one deliberate
 * exception: the company ROOT (the single position with no manager) stays
 * available so a department's top role can report up to the company head,
 * which is the only legitimate cross-department reporting link. Passing an
 * empty `departmentId` applies no department scope. `query` filters by
 * title or code.
 *
 * This is a relevance filter for the UI only — the server still
 * re-validates the chosen manager on submit, so narrowing here can never
 * be a security assumption. Reports-To is entirely independent of the
 * career-framework fields above it in the form.
 */
export function scopeReportsToOptions(
  allPositions: readonly Position[],
  departmentId: string,
  query: string,
  jobFamilyNameById?: ReadonlyMap<string, string>
): ComboboxOption[] {
  const q = query.trim().toLowerCase();
  return allPositions
    .filter((candidate) => {
      // Same-department positions, plus the company root (so a department's
      // top role can still report to the company head). No other department's
      // positions are offered. With no department chosen, everything is shown.
      const inScope =
        departmentId === "" ||
        candidate.departmentId === departmentId ||
        candidate.primaryReportsToPositionId === null;
      if (!inScope) return false;
      return (
        q === "" ||
        candidate.title.toLowerCase().includes(q) ||
        candidate.positionCode.toLowerCase().includes(q)
      );
    })
    .map((candidate) => ({
      value: candidate.id,
      label: candidate.title,
      description: reportsToDescription(candidate, jobFamilyNameById),
    }));
}

/**
 * The secondary line under a reports-to option. Shows the position's job
 * family only — never the organizational level (removed as noise) nor the
 * internal position code. Returns undefined when the position has no family,
 * so the option shows just its title.
 */
export function reportsToDescription(
  candidate: Pick<Position, "jobFamilyId">,
  jobFamilyNameById?: ReadonlyMap<string, string>
): string | undefined {
  return candidate.jobFamilyId
    ? (jobFamilyNameById?.get(candidate.jobFamilyId) ?? undefined)
    : undefined;
}

/**
 * Create/edit dialog. Fields: Department, optional Sub-division, a plain
 * IC/Manager/None "Career track" choice (stored on the position as its ladder
 * context), Level, and a free-text Title. The Title is never auto-filled. NONE
 * of this sets reporting: Reports-To (create only) is a separate, independent
 * picker. When editing, Reports-To is intentionally NOT here — changing an
 * existing position's place in the hierarchy goes through the dedicated
 * `PositionMoveDialog`.
 */
export function PositionFormDialog({
  open,
  onOpenChange,
  position,
  departments,
  jobGrades,
  jobFamilies,
  careerTracks,
  allPositions,
  initialDepartmentId,
  initialReportsToPositionId,
  initialJobFamilyId,
  levelTitles = [],
  subDivisionLevelTitles = [],
  onSaved,
}: PositionFormDialogProps) {
  const isEdit = position !== null;
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [reportsToQuery, setReportsToQuery] = useState("");
  // Optional second head on create (docs/DECISIONS.md D27): "" = none.
  const [coHeadValue, setCoHeadValue] = useState("");
  const [coHeadQuery, setCoHeadQuery] = useState("");

  // "Assigned employee" picker. `occupantValue` is the chosen employee id, ""
  // for vacant. `initialOccupant` is what the position started with, so a save
  // only touches assignments when the occupant actually changed. Employees are
  // loaded when the dialog opens.
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
  const [occupantValue, setOccupantValue] = useState("");
  const [initialOccupant, setInitialOccupant] = useState("");
  const [occupantQuery, setOccupantQuery] = useState("");
  // Once a create succeeds, remember the new id so a retry (e.g. after an
  // occupant-assignment error) updates that position instead of creating a duplicate.
  const justCreatedIdRef = useRef<string | null>(null);
  // Set once the user picks an occupant, so a slow occupant fetch can never
  // overwrite their choice.
  const occupantTouchedRef = useRef(false);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      title: "",
      departmentId: "",
      jobFamilyId: null,
      careerTrackKind: null,
      jobGradeCode: null,
      description: null,
      primaryReportsToPositionId: null,
    },
  });

  // Reset exactly once per dialog-open transition (see the departments
  // backfill note below) — read live props via refs so async-loaded data
  // is used without re-running this effect and wiping typed input.
  const wasOpen = useRef(false);
  const positionRef = useRef(position);
  positionRef.current = position;
  const departmentsRef = useRef(departments);
  departmentsRef.current = departments;
  const careerTracksRef = useRef(careerTracks);
  careerTracksRef.current = careerTracks;
  const jobGradesRef = useRef(jobGrades);
  jobGradesRef.current = jobGrades;
  const initialDepartmentIdRef = useRef(initialDepartmentId);
  initialDepartmentIdRef.current = initialDepartmentId;
  const initialReportsToPositionIdRef = useRef(initialReportsToPositionId);
  initialReportsToPositionIdRef.current = initialReportsToPositionId;
  const initialJobFamilyIdRef = useRef(initialJobFamilyId);
  initialJobFamilyIdRef.current = initialJobFamilyId;

  useEffect(() => {
    if (open && !wasOpen.current) {
      const currentPosition = positionRef.current;
      const currentDepartments = departmentsRef.current;
      setFormError(null);
      setReportsToQuery("");
      // Derive the plain IC/Manager choice from the position's stored track,
      // so editing shows the same choice the form offers.
      const currentTrack = currentPosition?.careerTrackId
        ? careerTracksRef.current.find((t) => t.id === currentPosition.careerTrackId)
        : undefined;
      reset({
        title: currentPosition?.title ?? "",
        // Create-mode prefill (add-a-report from the organogram) wins over the
        // first-department default; editing always uses the position's own.
        departmentId:
          currentPosition?.departmentId ??
          initialDepartmentIdRef.current ??
          currentDepartments[0]?.id ??
          "",
        jobFamilyId: currentPosition
          ? (currentPosition.jobFamilyId ?? null)
          : (initialJobFamilyIdRef.current ?? null),
        // Prefer the ladder stored directly on the position; fall back to the
        // kind of its resolved family track for older rows.
        careerTrackKind: currentPosition?.ladderKind ?? currentTrack?.kind ?? null,
        // The position stores a grade id; the picker works in level codes, so
        // map the id back to its code for editing.
        jobGradeCode: currentPosition?.jobGradeId
          ? (jobGradesRef.current.find((g) => g.id === currentPosition.jobGradeId)?.code ?? null)
          : null,
        description: currentPosition?.description ?? null,
        primaryReportsToPositionId: currentPosition
          ? null
          : (initialReportsToPositionIdRef.current ?? null),
      });
    }
    wasOpen.current = open;
  }, [open, reset]);

  // Backfill the department default if the dialog opened before
  // `departments` loaded — only while the field is still untouched.
  useEffect(() => {
    if (open && departments.length > 0 && !position && !watch("departmentId")) {
      setValue("departmentId", departments[0]?.id ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, departments]);

  // Load the employee options and, when editing, the position's current
  // occupant, each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    justCreatedIdRef.current = null;
    occupantTouchedRef.current = false;
    setCoHeadValue("");
    setCoHeadQuery("");
    setOccupantQuery("");
    setOccupantValue("");
    setInitialOccupant("");
    listEmployeeOptionsAction().then((result) => {
      if (result.ok) setEmployeeOptions(result.data);
    });
    const editing = positionRef.current;
    if (editing) {
      getPositionOccupantAction(editing.id).then((result) => {
        if (result.ok) {
          const value = result.data.employeeId ?? "";
          setInitialOccupant(value);
          if (!occupantTouchedRef.current) setOccupantValue(value);
        }
      });
    }
  }, [open]);

  const departmentId = watch("departmentId");
  const jobFamilyId = watch("jobFamilyId");
  const careerTrackKind = watch("careerTrackKind");
  const jobGradeCode = watch("jobGradeCode");
  const primaryReportsToPositionId = watch("primaryReportsToPositionId");

  const hasRoot = allPositions.some((candidate) => candidate.primaryReportsToPositionId === null);

  // Level options: the WHOLE standard scale (L2–L18), so any level can be
  // assigned even before it has been set up in Settings — the action creates
  // the grade for this department on first use. Each option reads as its code
  // plus the level's role name; a company that has renamed a level keeps that
  // name (existing grade name overrides the scale default).
  const gradeNameByCode = useMemo(() => {
    const byCode = new Map<string, string>();
    for (const g of jobGrades) {
      // Prefer a shared (company-wide) grade's name over a per-department one.
      if (!byCode.has(g.code) || !g.departmentId) {
        if (g.name) byCode.set(g.code, g.name);
      }
    }
    return byCode;
  }, [jobGrades]);
  // Level names follow the chosen sub-division, then department (and ladder):
  // their own Levels-Mapping names when they have them, else the standard
  // names (D32, D34).
  const levelOptions = useMemo(
    () =>
      JOB_GRADE_SCALE.map((s) => ({
        code: s.code,
        label: `${s.code} — ${levelNameFor({
          code: s.code,
          defaultName: gradeNameByCode.get(s.code) ?? s.name,
          departmentId: departmentId ?? "",
          kind: careerTrackKind === "IC" || careerTrackKind === "MANAGER" ? careerTrackKind : null,
          levelTitles,
          jobFamilyId,
          subDivisionLevelTitles,
          jobGrades: jobGrades.map((g) => ({
            departmentId: g.departmentId,
            code: g.code,
            name: g.name,
          })),
        })}`,
      })),
    [
      gradeNameByCode,
      departmentId,
      careerTrackKind,
      levelTitles,
      jobFamilyId,
      subDivisionLevelTitles,
      jobGrades,
    ]
  );

  // Sub-divisions in the selected department. Optional — a position need
  // not be classified.
  const familyOptions = useMemo(
    () => jobFamilies.filter((f) => f.departmentId === departmentId),
    [jobFamilies, departmentId]
  );

  const jobFamilyNameById = useMemo(
    () => new Map(jobFamilies.map((f) => [f.id, f.name])),
    [jobFamilies]
  );
  const reportsToOptions: ComboboxOption[] = useMemo(() => {
    const scoped = scopeReportsToOptions(
      allPositions,
      departmentId,
      reportsToQuery,
      jobFamilyNameById
    );
    // The chosen manager is always listed, even when they sit in another
    // department (e.g. a sub-department's head reporting into its parent
    // department, pre-filled from the organogram's +).
    const chosen = primaryReportsToPositionId
      ? allPositions.find((p) => p.id === primaryReportsToPositionId)
      : undefined;
    if (!chosen || scoped.some((o) => o.value === chosen.id)) return scoped;
    const q = reportsToQuery.trim().toLowerCase();
    if (
      q &&
      !chosen.title.toLowerCase().includes(q) &&
      !chosen.positionCode.toLowerCase().includes(q)
    ) {
      return scoped;
    }
    return [
      {
        value: chosen.id,
        label: chosen.title,
        description: reportsToDescription(chosen, jobFamilyNameById),
      },
      ...scoped,
    ];
  }, [allPositions, reportsToQuery, departmentId, jobFamilyNameById, primaryReportsToPositionId]);

  // Second-head options: "None", then the same scoped positions as "Reports
  // to" minus whichever is already chosen as the first head.
  const coHeadOptions: ComboboxOption[] = useMemo(
    () => [
      { value: "", label: "None (reports to one head only)" },
      ...scopeReportsToOptions(allPositions, departmentId, coHeadQuery, jobFamilyNameById).filter(
        (option) => option.value !== primaryReportsToPositionId
      ),
    ],
    [allPositions, departmentId, coHeadQuery, jobFamilyNameById, primaryReportsToPositionId]
  );
  const effectiveCoHead =
    primaryReportsToPositionId && coHeadValue !== primaryReportsToPositionId ? coHeadValue : "";

  // "Assigned employee" options: a "Vacant" choice plus every active employee,
  // filtered by the picker's query (name or code).
  const employeeOptionsForCombobox: ComboboxOption[] = useMemo(() => {
    const q = occupantQuery.trim().toLowerCase();
    const name = (e: EmployeeOption) =>
      (e.preferredName?.trim() || `${e.firstName} ${e.lastName}`.trim()).trim();
    const matches = employeeOptions.filter(
      (e) =>
        q === "" || name(e).toLowerCase().includes(q) || e.employeeCode.toLowerCase().includes(q)
    );
    return [
      { value: "", label: "Vacant (no one assigned)" },
      ...matches.map((e) => ({ value: e.id, label: name(e), description: e.employeeCode })),
    ];
  }, [employeeOptions, occupantQuery]);

  function onSubmit(values: FormValues) {
    setFormError(null);
    const applyFailure = (result: { error: string; fieldErrors?: Record<string, string> }) => {
      setFormError(result.error);
      if (result.fieldErrors) {
        for (const [field, message] of Object.entries(result.fieldErrors)) {
          if (field in values) setError(field as keyof FormValues, { message });
        }
      }
    };
    startTransition(async () => {
      // Persist the position first. On edit we update in place; on create we
      // create once and then remember the new id, so if a later step fails and
      // the user retries, we update that position instead of duplicating it.
      const editingId = isEdit ? position.id : justCreatedIdRef.current;
      let positionId: string;
      if (editingId) {
        const result = await updatePositionAction({
          positionId: editingId,
          title: values.title,
          departmentId: values.departmentId,
          // Send the level CODE; the action resolves it to a grade for the
          // department (creating it on first use). null clears the level.
          jobGradeCode: values.jobGradeCode,
          jobFamilyId: values.jobFamilyId,
          // Stored on the position as its ladder context; also resolves the
          // family track when a sub-division is chosen.
          careerTrackKind: values.careerTrackKind,
          description: values.description,
        });
        if (!result.ok) return applyFailure(result);
        positionId = editingId;
      } else {
        const result = await createPositionAction({
          title: values.title,
          departmentId: values.departmentId,
          jobGradeCode: values.jobGradeCode,
          jobFamilyId: values.jobFamilyId,
          careerTrackKind: values.careerTrackKind,
          description: values.description,
          primaryReportsToPositionId: values.primaryReportsToPositionId,
          // Only with a first head, and never the same position twice.
          coReportsToPositionId: effectiveCoHead || null,
        });
        if (!result.ok) return applyFailure(result);
        positionId = result.data.id;
        justCreatedIdRef.current = positionId;
      }

      // Only touch assignments when the occupant actually changed.
      if (occupantValue !== initialOccupant) {
        const occ = await setPositionOccupantAction({
          positionId,
          employeeId: occupantValue || null,
        });
        if (!occ.ok) {
          // The position saved, but the occupant change didn't (e.g. the person
          // already holds another position). Keep the dialog open with the
          // reason and refresh the list to reflect the saved position; a retry
          // updates rather than re-creates.
          setFormError(occ.error);
          onSaved();
          return;
        }
        setInitialOccupant(occupantValue);
      }

      onOpenChange(false);
      onSaved();
    });
  }

  const busy = isSubmitting || pending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={isEdit ? `Edit ${position.title}` : "Add Position"}
        description={
          isEdit
            ? "Update this position's details. To change who it reports to, use “Change Reports-To” instead."
            : "Create a new position."
        }
      >
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {formError ? (
            <p role="alert" className="text-destructive text-sm font-medium">
              {formError}
            </p>
          ) : null}

          <Field label="Department" required error={errors.departmentId?.message}>
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={departmentId}
                onChange={(event) => {
                  const newDept = event.target.value;
                  setValue("departmentId", newDept, { shouldValidate: true });
                  // Sub-division is scoped to the department, so a family from
                  // the old department no longer applies — clear it and the
                  // track choice with it.
                  setValue("jobFamilyId", null);
                  setValue("careerTrackKind", null);
                  // Reports-To is department-scoped too; drop a now-out-of-scope
                  // manager (keep the root CEO, always allowed).
                  const chosen = allPositions.find((p) => p.id === primaryReportsToPositionId);
                  if (
                    chosen &&
                    chosen.departmentId !== newDept &&
                    chosen.primaryReportsToPositionId !== null
                  ) {
                    setValue("primaryReportsToPositionId", null);
                  }
                }}
              >
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Sub-division"
            hint="Career specialization (optional). Independent of reporting."
          >
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={jobFamilyId ?? ""}
                onChange={(event) => {
                  setValue("jobFamilyId", event.target.value || null);
                  setValue("careerTrackKind", null);
                }}
              >
                <option value="">
                  {familyOptions.length === 0 ? "None for this department" : "None"}
                </option>
                {familyOptions.map((family) => (
                  <option key={family.id} value={family.id}>
                    {family.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Career track"
            hint="Is this an Individual Contributor or Manager role? Optional. Does not affect who reports to whom."
          >
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={careerTrackKind ?? ""}
                onChange={(event) =>
                  setValue(
                    "careerTrackKind",
                    (event.target.value || null) as "IC" | "MANAGER" | null
                  )
                }
              >
                <option value="">None</option>
                <option value="IC">Individual Contributor</option>
                <option value="MANAGER">Manager</option>
              </Select>
            )}
          </Field>

          <Field
            label="Level"
            hint="Career seniority (e.g. L7). Does not affect who reports to whom."
          >
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={jobGradeCode ?? ""}
                onChange={(event) => setValue("jobGradeCode", event.target.value || null)}
              >
                <option value="">No level</option>
                {levelOptions.map((level) => (
                  <option key={level.code} value={level.code}>
                    {level.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Title" required error={errors.title?.message}>
            {(fieldProps) => (
              <Input
                {...fieldProps}
                {...register("title", { required: "Title is required." })}
                autoFocus
              />
            )}
          </Field>

          <Field label="Description" error={errors.description?.message}>
            {(fieldProps) => <Textarea {...fieldProps} {...register("description")} rows={3} />}
          </Field>

          <Field
            label="Assigned employee"
            hint="Who currently holds this position (optional). Pick from the Employees module, or leave vacant."
          >
            {(fieldProps) => (
              <Combobox
                {...fieldProps}
                value={occupantValue}
                onChange={(value) => {
                  occupantTouchedRef.current = true;
                  setOccupantValue(value ?? "");
                }}
                options={employeeOptionsForCombobox}
                query={occupantQuery}
                onQueryChange={setOccupantQuery}
                placeholder="Search employees…"
                aria-label="Assigned employee"
              />
            )}
          </Field>

          {!isEdit ? (
            <Field
              label="Reports to"
              required={hasRoot}
              error={undefined}
              hint={hasRoot ? undefined : "Leave empty to create the company's root position."}
            >
              {(fieldProps) => (
                <Combobox
                  {...fieldProps}
                  value={primaryReportsToPositionId ?? null}
                  onChange={(value) =>
                    setValue("primaryReportsToPositionId", value, { shouldValidate: true })
                  }
                  options={reportsToOptions}
                  query={reportsToQuery}
                  onQueryChange={setReportsToQuery}
                  placeholder={hasRoot ? "Search positions…" : "None (root position)"}
                  aria-label="Reports to"
                />
              )}
            </Field>
          ) : null}

          {!isEdit && primaryReportsToPositionId ? (
            <Field
              label="Second Reports-To (optional)"
              hint="Pick a second head if this position reports to two heads. Both are shown equally on the organogram."
            >
              {(fieldProps) => (
                <Combobox
                  {...fieldProps}
                  value={effectiveCoHead}
                  onChange={(value) => setCoHeadValue(value ?? "")}
                  options={coHeadOptions}
                  query={coHeadQuery}
                  onQueryChange={setCoHeadQuery}
                  placeholder="Search positions…"
                  aria-label="Second Reports-To"
                />
              )}
            </Field>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : isEdit ? "Save changes" : "Create position"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
