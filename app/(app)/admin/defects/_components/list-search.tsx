"use client";

import { useCallback, useId, useState } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";

/**
 * A search box whose query lives in the address (?q=), so a reload or a
 * shared link keeps it, without a server round trip: the lists here are
 * short, so they filter in the browser as the admin types.
 */
export function useQuery(initialQuery: string) {
  const [query, setQueryState] = useState(initialQuery);
  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    const url = new URL(window.location.href);
    const trimmed = next.trim();
    if (trimmed) url.searchParams.set("q", trimmed);
    else url.searchParams.delete("q");
    // Next.js keeps its router in step with the History API (no server render).
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  return { query, setQuery };
}

type ListSearchProps = {
  query: string;
  onQueryChange: (query: string) => void;
  /** Accessible name, e.g. "Search codes". */
  label: string;
  placeholder: string;
  /** What is left showing, e.g. "4 of 32 codes", announced as it changes. */
  count: string;
};

/** The search box and the count it leaves showing. */
export function ListSearch({ query, onQueryChange, label, placeholder, count }: ListSearchProps) {
  const id = useId();
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
              aria-label="Clear Search"
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
