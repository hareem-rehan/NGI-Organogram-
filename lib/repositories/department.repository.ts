import "server-only";
import type { Department, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import type { DbClient } from "@/lib/repositories/types";
import { HierarchyDepthExceededError, MAX_HIERARCHY_DEPTH } from "@/lib/domain/hierarchy";

export async function listDepartmentsForCompany(
  companyId: string,
  db: DbClient = prisma
): Promise<Department[]> {
  return db.department.findMany({
    where: { companyId },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
  });
}

export interface DepartmentSearchParams {
  companyId: string;
  search?: string;
  status?: "ACTIVE" | "INACTIVE";
  page: number;
  pageSize: number;
}

export interface DepartmentSearchResult {
  items: Department[];
  totalCount: number;
}

/**
 * Server-side paginated/filterable department listing for the
 * Departments screen. `search` matches name or code (case-insensitive,
 * substring) — never a raw LIKE built from unescaped input, since Prisma
 * parameterizes `contains` for us.
 */
export async function searchDepartments(
  params: DepartmentSearchParams,
  db: DbClient = prisma
): Promise<DepartmentSearchResult> {
  const where: Prisma.DepartmentWhereInput = {
    companyId: params.companyId,
    ...(params.status ? { status: params.status } : {}),
    ...(params.search
      ? {
          OR: [
            { name: { contains: params.search, mode: "insensitive" } },
            { code: { contains: params.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, totalCount] = await Promise.all([
    db.department.findMany({
      where,
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    db.department.count({ where }),
  ]);

  return { items, totalCount };
}

export async function findDepartmentById(
  id: string,
  companyId: string,
  db: DbClient = prisma
): Promise<Department | null> {
  return db.department.findFirst({ where: { id, companyId } });
}

export async function countPositionsInDepartment(
  departmentId: string,
  companyId: string,
  db: DbClient = prisma
): Promise<number> {
  return db.position.count({ where: { departmentId, companyId } });
}

export async function countChildDepartments(
  departmentId: string,
  companyId: string,
  db: DbClient = prisma
): Promise<number> {
  return db.department.count({ where: { parentDepartmentId: departmentId, companyId } });
}

/**
 * Walks parentDepartmentId from `startDepartmentId` up to the root,
 * returning ids in "start, parent, grandparent, ..." order (inclusive of
 * `startDepartmentId` itself). Used by the cycle check in
 * lib/services/department.service.ts via domain/hierarchy's
 * `wouldCreateCycle` — the same generic "is X in this ancestor chain?"
 * logic applies to departments as well as positions.
 */
export async function getDepartmentAncestorChain(
  startDepartmentId: string,
  companyId: string,
  db: DbClient = prisma
): Promise<string[]> {
  const chain: string[] = [];
  let currentId: string | null = startDepartmentId;

  while (currentId !== null) {
    if (chain.length > MAX_HIERARCHY_DEPTH) {
      throw new HierarchyDepthExceededError(MAX_HIERARCHY_DEPTH);
    }
    chain.push(currentId);
    const current: { parentDepartmentId: string | null } | null = await db.department.findFirst({
      where: { id: currentId, companyId },
      select: { parentDepartmentId: true },
    });
    currentId = current?.parentDepartmentId ?? null;
  }

  return chain;
}
