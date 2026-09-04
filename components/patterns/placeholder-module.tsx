import { Construction } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";

interface PlaceholderModuleProps {
  title: string;
  description: string;
  plannedPhase: number;
}

/**
 * Used by every Phase 1 stub route (Dashboard, Organogram, Departments,
 * Positions, Employees, Imports, Audit Log, Settings). Deliberately has
 * no buttons, forms, or data — only an honest "not built yet" state, per
 * the standing rule against placeholder functionality that looks working.
 */
export function PlaceholderModule({ title, description, plannedPhase }: PlaceholderModuleProps) {
  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={<Badge variant="warning">Planned for Phase {plannedPhase}</Badge>}
      />
      <EmptyState
        icon={Construction}
        title="This module isn't built yet"
        description={`${title} will be implemented in Phase ${plannedPhase} of the delivery plan (see docs/IMPLEMENTATION_PLAN.md). Nothing on this page is functional.`}
      />
    </div>
  );
}
