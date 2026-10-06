"use client";

// Shared by /admin/manufacturers and /admin/clients (see reference-panel.tsx).

import { useCallback, useId, useMemo, useState } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { matchesSearch } from "@/lib/admin/reference";

/**
 * Filters a list as the admin types, in the browser: reference lists are
 * short, and every keystroke answers at once. The query lives in the address
 * (?q=), so a reload or a shared link keeps it, without a server round trip.
 * `textOf` must be stable (a module-level function).
 */
export function useListSearch<T>(rows: readonly T[], initialQuery: string, textOf: (row: T) => string) {
  const [query, setQueryState] = useState(initialQuery);
  const indexed = useMemo(() => rows.map((row) => ({ row, text: textOf(row) })), [rows, textOf]);
  const results = useMemo(
    () => indexed.filter((entry) => matchesSearch(entry.text, query)).map((entry) => entry.row),
    [indexed, query],
  );
  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    keepQueryInAddress(next);
  }, []);
  return { query, setQuery, results };
}

function keepQueryInAddress(query: string) {
  const url = new URL(window.location.href);
  const trimmed = query.trim();
  if (trimmed) url.searchParams.set("q", trimmed);
  else url.searchParams.delete("q");
  // Next.js keeps its router in step with the History API (no re-render on the server).
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

type ListSearchProps = {
  query: string;
  onQueryChange: (query: string) => void;
  /** Accessible name, e.g. "Search manufacturers". */
  label: string;
  placeholder: string;
  shown: number;
  total: number;
  /** Plural noun for the count, e.g. "manufacturers". */
  noun: { one: string; many: string };
};

/** The search box and the count it leaves showing, announced as it changes. */
export function ListSearch({ query, onQueryChange, label, placeholder, shown, total, noun }: ListSearchProps) {
  const id = useId();
  const count =
    shown === total
      ? `${total.toLocaleString("en-GB")} ${total === 1 ? noun.one : noun.many}`
      : `${shown.toLocaleString("en-GB")} of ${total.toLocaleString("en-GB")} ${noun.many}`;

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <InputGroup className="w-full bg-card md:max-w-md">
        <InputGroupAddon>
          <SearchIcon aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          type="search"
          aria-label={label}
          placeholder={placeholder}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              onQueryChange("");
            }
          }}
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="[&::-webkit-search-cancel-button]:appearance-none"
        />
        {query && (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label="Clear search"
              onClick={() => {
                onQueryChange("");
                // The button goes with the query; keep the keyboard in the box.
                document.getElementById(id)?.focus();
              }}
            >
              <XIcon aria-hidden />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
      <p aria-live="polite" aria-atomic="true" className="text-sm text-muted-foreground tabular-nums">
        {count}
      </p>
    </div>
  );
}
