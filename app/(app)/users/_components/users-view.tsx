"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import type { Employee, User, UserRole, UserStatus } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingState } from "@/components/patterns/loading-state";
import { Pagination } from "@/components/patterns/pagination";
import { ConfirmDialog, useConfirmDialog } from "@/components/patterns/confirm-dialog";
import { DEFAULT_USER_PAGE_SIZE } from "@/lib/domain/user-admin-pagination";
import {
  changeUserRoleAction,
  disableUserAction,
  linkEmployeeAction,
  listUsersAction,
  provisionUserAction,
  reactivateUserAction,
  searchEmployeesForLinkingAction,
  unlinkEmployeeAction,
} from "@/app/(app)/users/actions";

type RoleFilter = "ALL" | UserRole;
type StatusFilter = "ALL" | UserStatus;
type LinkedFilter = "ALL" | "linked" | "unlinked";

function roleBadgeVariant(role: UserRole): "default" | "secondary" | "outline" {
  if (role === "ADMIN") return "default";
  if (role === "HR_EDITOR") return "secondary";
  return "outline";
}

export function UsersView() {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<RoleFilter>("ALL");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [linked, setLinked] = useState<LinkedFilter>("ALL");
  const [page, setPage] = useState(1);

  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [provisionOpen, setProvisionOpen] = useState(false);
  const [roleTarget, setRoleTarget] = useState<User | null>(null);
  const [linkTarget, setLinkTarget] = useState<User | null>(null);

  const disableDialog = useConfirmDialog();
  const [disableTarget, setDisableTarget] = useState<User | null>(null);
  const [disablePending, setDisablePending] = useState(false);
  const [disableError, setDisableError] = useState<string | null>(null);

  const [rowError, setRowError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    startTransition(async () => {
      const result = await listUsersAction({
        search: search || undefined,
        role: role === "ALL" ? undefined : role,
        status: status === "ALL" ? undefined : status,
        linked: linked === "ALL" ? undefined : linked,
        page,
        pageSize: DEFAULT_USER_PAGE_SIZE,
      });
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setUsers(result.data.users);
      setTotal(result.data.total);
    });
  }, [search, role, status, linked, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  async function handleReactivate(user: User) {
    setRowError(null);
    const result = await reactivateUserAction({ userId: user.id });
    if (!result.ok) {
      setRowError(result.error);
      return;
    }
    refresh();
  }

  async function handleDisableConfirm() {
    if (!disableTarget) return;
    setDisablePending(true);
    setDisableError(null);
    const result = await disableUserAction({
      userId: disableTarget.id,
      expectedUpdatedAt: disableTarget.updatedAt,
    });
    setDisablePending(false);
    if (!result.ok) {
      setDisableError(result.error);
      return;
    }
    disableDialog.setOpen(false);
    setDisableTarget(null);
    refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Search">
            {(fieldProps) => (
              <Input
                {...fieldProps}
                value={search}
                placeholder="Name or email"
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            )}
          </Field>
          <Field label="Role">
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={role}
                onChange={(e) => {
                  setRole(e.target.value as RoleFilter);
                  setPage(1);
                }}
              >
                <option value="ALL">All roles</option>
                <option value="ADMIN">ADMIN</option>
                <option value="HR_EDITOR">HR_EDITOR</option>
                <option value="VIEWER">VIEWER</option>
              </Select>
            )}
          </Field>
          <Field label="Status">
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as StatusFilter);
                  setPage(1);
                }}
              >
                <option value="ALL">All statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="DISABLED">Disabled</option>
              </Select>
            )}
          </Field>
          <Field label="Employee link">
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={linked}
                onChange={(e) => {
                  setLinked(e.target.value as LinkedFilter);
                  setPage(1);
                }}
              >
                <option value="ALL">All</option>
                <option value="linked">Linked</option>
                <option value="unlinked">Unlinked</option>
              </Select>
            )}
          </Field>
        </div>
        <Button type="button" onClick={() => setProvisionOpen(true)}>
          Provision User
        </Button>
      </div>

      {rowError ? (
        <p role="alert" className="text-destructive text-sm font-medium">
          {rowError}
        </p>
      ) : null}

      {loading && users.length === 0 ? (
        <LoadingState label="Loading users…" />
      ) : error ? (
        <ErrorState description={error} onRetry={refresh} />
      ) : users.length === 0 ? (
        <EmptyState
          title="No matching users"
          description="Try removing a filter, or provision a new user."
        />
      ) : (
        <div className="border-border overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground text-left text-xs uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Employee link</th>
                <th className="px-3 py-2 font-medium">Last login</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-3 py-2 whitespace-nowrap">{user.name ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{user.email}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Badge variant={roleBadgeVariant(user.role)}>{user.role}</Badge>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Badge variant={user.status === "ACTIVE" ? "success" : "destructive"}>
                      {user.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {user.linkedEmployeeId ? "Linked" : "—"}
                  </td>
                  <td className="text-muted-foreground px-3 py-2 whitespace-nowrap">
                    {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : "Never"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setRoleTarget(user)}
                      >
                        Change Role
                      </Button>
                      {user.status === "ACTIVE" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setDisableTarget(user);
                            disableDialog.setOpen(true);
                          }}
                        >
                          Disable
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleReactivate(user)}
                        >
                          Reactivate
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setLinkTarget(user)}
                      >
                        {user.linkedEmployeeId ? "Unlink" : "Link Employee"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && users.length > 0 ? (
        <Pagination
          page={page}
          pageSize={DEFAULT_USER_PAGE_SIZE}
          totalCount={total}
          onPageChange={setPage}
        />
      ) : null}

      <ProvisionUserDialog
        open={provisionOpen}
        onOpenChange={setProvisionOpen}
        onProvisioned={refresh}
      />

      <ChangeRoleDialog
        user={roleTarget}
        onOpenChange={(open) => !open && setRoleTarget(null)}
        onChanged={refresh}
      />

      <LinkEmployeeDialog
        user={linkTarget}
        onOpenChange={(open) => !open && setLinkTarget(null)}
        onChanged={refresh}
      />

      <ConfirmDialog
        open={disableDialog.open}
        onOpenChange={(open) => {
          disableDialog.setOpen(open);
          if (!open) setDisableTarget(null);
        }}
        title="Disable user?"
        description={`${disableTarget?.email ?? "This user"} will immediately lose access — their active sessions are ended, and they cannot sign in again until reactivated. Their Employee record (if linked) is not affected.`}
        confirmLabel="Disable User"
        destructive
        pending={disablePending}
        errorMessage={disableError}
        onConfirm={handleDisableConfirm}
      />
    </div>
  );
}

function ProvisionUserDialog({
  open,
  onOpenChange,
  onProvisioned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProvisioned: () => void;
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<UserRole>("VIEWER");
  const [confirmElevated, setConfirmElevated] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEmail("");
    setDisplayName("");
    setRole("VIEWER");
    setConfirmElevated(false);
    setError(null);
  }, [open]);

  const needsConfirmation = role !== "VIEWER";

  async function handleSubmit() {
    if (needsConfirmation && !confirmElevated) return;
    setPending(true);
    setError(null);
    const result = await provisionUserAction({
      email,
      displayName: displayName || null,
      role,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
    onProvisioned();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Provision User"
        description="Reserves a company-email identity and role. The person gains access the next time they sign in through Company SSO — no password is ever set here."
      >
        <div className="flex flex-col gap-4">
          <Field label="Company email" required>
            {(fieldProps) => (
              <Input
                {...fieldProps}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            )}
          </Field>
          <Field label="Display name" hint="Optional">
            {(fieldProps) => (
              <Input
                {...fieldProps}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            )}
          </Field>
          <Field label="Role" required>
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
              >
                <option value="VIEWER">VIEWER</option>
                <option value="HR_EDITOR">HR_EDITOR</option>
                <option value="ADMIN">ADMIN</option>
              </Select>
            )}
          </Field>
          {needsConfirmation ? (
            <label className="border-status-planned/40 bg-status-planned/5 flex items-start gap-2 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                className="accent-primary mt-0.5 size-4"
                checked={confirmElevated}
                onChange={(e) => setConfirmElevated(e.target.checked)}
              />
              I understand this grants {role} access, an elevated role beyond read-only.
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="text-destructive text-sm font-medium">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={!email || pending || (needsConfirmation && !confirmElevated)}
            >
              Provision User
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChangeRoleDialog({
  user,
  onOpenChange,
  onChanged,
}: {
  user: User | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [newRole, setNewRole] = useState<UserRole>("VIEWER");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNewRole(user.role);
    setConfirmed(false);
    setError(null);
  }, [user]);

  if (!user) return null;

  const isElevatedChange = (newRole === "ADMIN" || user.role === "ADMIN") && newRole !== user.role;

  async function handleSubmit() {
    if (!user) return;
    if (isElevatedChange && !confirmed) return;
    setPending(true);
    setError(null);
    const result = await changeUserRoleAction({
      userId: user.id,
      newRole,
      expectedUpdatedAt: user.updatedAt,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
    onChanged();
  }

  return (
    <Dialog open={Boolean(user)} onOpenChange={onOpenChange}>
      <DialogContent title="Change Role" description={`Change the role for ${user.email}.`}>
        <div className="flex flex-col gap-4">
          <Field label="New role">
            {(fieldProps) => (
              <Select
                {...fieldProps}
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as UserRole)}
              >
                <option value="VIEWER">VIEWER</option>
                <option value="HR_EDITOR">HR_EDITOR</option>
                <option value="ADMIN">ADMIN</option>
              </Select>
            )}
          </Field>
          {isElevatedChange ? (
            <label className="border-status-planned/40 bg-status-planned/5 flex items-start gap-2 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                className="accent-primary mt-0.5 size-4"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I understand this {newRole === "ADMIN" ? "grants" : "removes"} ADMIN access
              {user.role === "ADMIN" && newRole !== "ADMIN"
                ? " — if this is the last active ADMIN, the change will be rejected"
                : ""}
              .
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="text-destructive text-sm font-medium">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={pending || newRole === user.role || (isElevatedChange && !confirmed)}
            >
              Save Role
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LinkEmployeeDialog({
  user,
  onOpenChange,
  onChanged,
}: {
  user: User | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Employee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearch("");
    setResults([]);
    setSelectedEmployeeId(null);
    setError(null);
  }, [user]);

  useEffect(() => {
    if (!user || user.linkedEmployeeId) return;
    let cancelled = false;
    void (async () => {
      const result = await searchEmployeesForLinkingAction(search || undefined);
      if (!cancelled && result.ok) setResults(result.data.items);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, search]);

  if (!user) return null;
  const isUnlink = Boolean(user.linkedEmployeeId);

  async function handleSubmit() {
    if (!user) return;
    setPending(true);
    setError(null);
    const result = isUnlink
      ? await unlinkEmployeeAction({ userId: user.id })
      : selectedEmployeeId
        ? await linkEmployeeAction({ userId: user.id, employeeId: selectedEmployeeId })
        : null;
    setPending(false);
    if (!result) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
    onChanged();
  }

  return (
    <Dialog open={Boolean(user)} onOpenChange={onOpenChange}>
      <DialogContent
        title={isUnlink ? "Unlink Employee" : "Link Employee"}
        description={
          isUnlink
            ? `Unlinking does not disable ${user.email} or affect the linked employee's record.`
            : `Search for the Employee record for ${user.email}. Linking never changes their role or assignment.`
        }
      >
        <div className="flex flex-col gap-4">
          {isUnlink ? null : (
            <>
              <Field label="Search employees">
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                )}
              </Field>
              <div className="max-h-48 overflow-y-auto rounded-md border">
                {results.length === 0 ? (
                  <p className="text-muted-foreground p-3 text-sm">No matching employees.</p>
                ) : (
                  results.map((employee) => (
                    <button
                      key={employee.id}
                      type="button"
                      onClick={() => setSelectedEmployeeId(employee.id)}
                      className={`hover:bg-accent block w-full px-3 py-2 text-left text-sm ${
                        selectedEmployeeId === employee.id ? "bg-accent" : ""
                      }`}
                    >
                      {employee.firstName} {employee.lastName} ({employee.employeeCode})
                    </button>
                  ))
                )}
              </div>
            </>
          )}
          {error ? (
            <p role="alert" className="text-destructive text-sm font-medium">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={isUnlink ? "destructive" : "default"}
              onClick={handleSubmit}
              disabled={pending || (!isUnlink && !selectedEmployeeId)}
            >
              {isUnlink ? "Unlink Employee" : "Link Employee"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
