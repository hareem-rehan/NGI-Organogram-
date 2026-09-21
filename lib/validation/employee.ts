import { z } from "zod";

import { pageSchema, pageSizeSchema, searchQuerySchema } from "@/lib/validation/pagination";

/**
 * Server-side validation for employee/assignment mutations
 * (docs/DATA_DICTIONARY.md "Employee"/"Position Assignment"). None of
 * these accept `companyId`, `employmentStatus` (create/update — status
 * changes go through their own narrower schemas), department, manager,
 * organizational level, or job grade — those are either session-derived
 * or always computed from the active position assignment, never
 * client-settable (docs/DOMAIN_MODEL.md).
 */
const employeeCodeSchema = z
  .string()
  .trim()
  .min(2, "Employee code must be at least 2 characters.")
  .max(30, "Employee code must be 30 characters or fewer.");

const nameSchema = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(100, `${label} must be 100 characters or fewer.`);

const preferredNameSchema = z
  .string()
  .trim()
  .max(100, "Preferred name must be 100 characters or fewer.")
  .nullable()
  .optional();

const workEmailSchema = z
  .string()
  .trim()
  .email("Enter a valid email address.")
  .max(255, "Email must be 255 characters or fewer.")
  .nullable()
  .optional()
  .or(z.literal("").transform(() => null));

const dateStringSchema = z.coerce.date().nullable().optional();

export const createEmployeeSchema = z
  .object({
    employeeCode: employeeCodeSchema,
    firstName: nameSchema("First name"),
    lastName: nameSchema("Last name"),
    preferredName: preferredNameSchema,
    workEmail: workEmailSchema,
    joiningDate: dateStringSchema,
  })
  .strict();
export type CreateEmployeeValues = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = z
  .object({
    employeeId: z.string().uuid(),
    employeeCode: employeeCodeSchema.optional(),
    firstName: nameSchema("First name").optional(),
    lastName: nameSchema("Last name").optional(),
    preferredName: preferredNameSchema,
    workEmail: workEmailSchema,
    joiningDate: dateStringSchema,
    leavingDate: dateStringSchema,
  })
  .strict();
export type UpdateEmployeeValues = z.infer<typeof updateEmployeeSchema>;

export const changeEmployeeStatusSchema = z
  .object({
    employeeId: z.string().uuid(),
    status: z.enum(["ACTIVE", "TRANSFERRED", "TERMINATED"]),
  })
  .strict();

export const terminateEmployeeSchema = z
  .object({
    employeeId: z.string().uuid(),
    terminationDate: z.coerce.date(),
  })
  .strict();

export const assignEmployeeSchema = z
  .object({
    employeeId: z.string().uuid(),
    positionId: z.string().uuid(),
    startDate: z.coerce.date(),
  })
  .strict();

export const transferEmployeeSchema = z
  .object({
    employeeId: z.string().uuid(),
    fromAssignmentId: z.string().uuid(),
    toPositionId: z.string().uuid(),
    transferDate: z.coerce.date(),
  })
  .strict();

export const endAssignmentSchema = z
  .object({
    assignmentId: z.string().uuid(),
    endDate: z.coerce.date(),
  })
  .strict();

export const listEmployeesQuerySchema = z
  .object({
    search: searchQuerySchema,
    status: z.enum(["ACTIVE", "TRANSFERRED", "TERMINATED"]).optional(),
    assignment: z.enum(["assigned", "unassigned"]).optional(),
    departmentId: z.string().uuid().optional(),
    page: pageSchema,
    pageSize: pageSizeSchema,
  })
  .strict();
export type ListEmployeesQuery = z.infer<typeof listEmployeesQuerySchema>;

export const eligiblePositionSearchSchema = z
  .object({
    search: searchQuerySchema,
    effectiveDate: z.coerce.date().optional(),
  })
  .strict();
