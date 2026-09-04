/**
 * Per-entity-type allowlists for `redactForAudit` (lib/domain/audit/redact.ts).
 * ADR-0015: an allowlist, not a denylist — a field left off this list
 * simply never appears in an audit diff, safe by default, rather than
 * needing someone to remember to add it to a "known bad" list before it
 * can leak. Keep this in sync with `prisma/schema.prisma`'s entity
 * shapes; a new field on an audited model is invisible in audit output
 * until explicitly added here (docs/AUDIT_AND_ADMIN_GUIDE.md).
 *
 * Deliberately excludes anything not needed to explain a change:
 * `createdAt`/`updatedAt` (redundant with the event's own timestamp),
 * raw foreign-key-adjacent internal ids where a human-readable field
 * already exists, and — for `User` — `image` (an SSO profile picture
 * URL; not needed to explain an administrative change and a small,
 * unnecessary bit of personal data to retain indefinitely).
 */
export const AUDIT_FIELD_ALLOWLISTS: Record<string, readonly string[]> = {
  Department: [
    "id",
    "name",
    "code",
    "description",
    "color",
    "parentDepartmentId",
    "status",
    "displayOrder",
  ],
  Position: [
    "id",
    "positionCode",
    "title",
    "description",
    "location",
    "status",
    "departmentId",
    "jobGradeId",
    "primaryReportsToPositionId",
    "organizationalLevel",
    "displayOrder",
  ],
  Employee: [
    "id",
    "employeeCode",
    "firstName",
    "lastName",
    "preferredName",
    "workEmail",
    "employmentStatus",
    "joiningDate",
    "leavingDate",
  ],
  PositionAssignment: ["id", "positionId", "employeeId", "isPrimary", "startDate", "endDate"],
  User: ["id", "email", "name", "companyId", "role", "status", "linkedEmployeeId"],
  CompanySettings: [
    "id",
    "companyId",
    "brandingText",
    "defaultExpansionDepth",
    "defaultViewMode",
    "showPlannedByDefault",
    "defaultPdfPageSize",
    "defaultPdfLayoutMode",
    "defaultPngScale",
    "includeLegendByDefault",
    "includeConfidentialityLabelByDefault",
    "exportRetentionDays",
  ],
  Company: ["id", "name", "legalName", "timezone", "code", "status"],
  ImportJob: [
    "id",
    "importType",
    "importMode",
    "originalFilename",
    "status",
    "totalRows",
    "validRows",
    "warningRows",
    "errorRows",
    "createCount",
    "updateCount",
    "unchangedCount",
  ],
  ExportJob: [
    "id",
    "format",
    "scope",
    "scopeLabel",
    "nodeCount",
    "status",
    "generatedFilename",
    "fileSize",
    "pageCount",
  ],
};
