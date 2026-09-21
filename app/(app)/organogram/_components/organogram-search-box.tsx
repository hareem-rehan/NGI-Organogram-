"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
  searchOrganogramNodes,
  SEARCH_MIN_QUERY_LENGTH,
  type OrganogramSearchResult,
} from "@/lib/domain/organogram-search";
import type { OrganogramNode } from "@/lib/domain/organogram";

interface OrganogramSearchBoxProps {
  nodes: readonly OrganogramNode[];
  showPlanned: boolean;
  onSelectResult: (positionId: string) => void;
}

const MATCH_TYPE_LABEL: Record<OrganogramSearchResult["matchType"], string> = {
  positionCode: "position code",
  title: "title",
  occupant: "occupant",
  department: "department",
};

function toOption(result: OrganogramSearchResult): ComboboxOption {
  const occupant = result.occupantDisplayName ?? "Vacant";
  const matchNote =
    result.matchType === "title" || result.matchType === "positionCode"
      ? ""
      : ` · matched via ${MATCH_TYPE_LABEL[result.matchType]}`;
  return {
    value: result.positionId,
    label: result.title,
    description: `${occupant} · ${result.departmentName} · Level ${result.organizationalLevel}${matchNote}`,
  };
}

/**
 * Debounced purely to keep typing smooth against a large (~2,000-position)
 * array on every keystroke — search itself is a synchronous, entirely
 * client-side in-memory computation over data already fetched by
 * getOrganogramAction (docs/ORGANOGRAM_SEARCH_AND_FOCUS.md "Architecture"),
 * so there is no network request to go stale and nothing to cancel; a
 * later keystroke's debounced recompute simply supersedes an earlier one.
 */
const DEBOUNCE_MS = 150;

export function OrganogramSearchBox({
  nodes,
  showPlanned,
  onSelectResult,
}: OrganogramSearchBoxProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const results = useMemo(
    () => searchOrganogramNodes(nodes, debouncedQuery, { showPlanned }),
    [nodes, debouncedQuery, showPlanned]
  );

  const trimmedLength = debouncedQuery.trim().length;
  const showEmptyMessage = trimmedLength >= SEARCH_MIN_QUERY_LENGTH && results.length === 0;

  function handleSelect(positionId: string) {
    onSelectResult(positionId);
    // Selecting a result is a complete action — clear the query so a
    // later reopen doesn't show a stale search (Step 4.13's "Clear
    // Search" intent, applied automatically after a successful pick).
    setQuery("");
    setDebouncedQuery("");
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <div className="min-w-0 flex-1">
        <Combobox
          value={null}
          onChange={handleSelect}
          options={results.map(toOption)}
          query={query}
          onQueryChange={setQuery}
          placeholder="Search by name, title, code, or department…"
          emptyMessage={
            trimmedLength < SEARCH_MIN_QUERY_LENGTH
              ? `Type at least ${SEARCH_MIN_QUERY_LENGTH} characters to search.`
              : "No matches."
          }
          aria-label="Search the organization chart"
        />
      </div>
      {query.length > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setQuery("")}
          aria-label="Clear search"
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {trimmedLength < SEARCH_MIN_QUERY_LENGTH
          ? ""
          : showEmptyMessage
            ? "No results found."
            : `${results.length} result${results.length === 1 ? "" : "s"} found.`}
      </p>
    </div>
  );
}
