"use client";

// The Users screen's search (_lib/user-search.ts): the box, the count beside
// the pickers and the rows it leaves in the list. The rows are drawn on the
// server and handed in whole; this only chooses which of them show, so a
// search answers every keystroke without a round trip. The search lives in
// the address (?q=, as on the reference lists), so a reload or a shared link
// keeps it. The Team picker carries it into the team it shows; a link to a
// team (a lead's name, Show Them, Show Their Team) opens the team whole.
import { createContext, Fragment, use, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { TableCell, TableRow } from "@/components/ui/table";
import { SEARCH_PARAM, type TeamFilter } from "../_lib/team-filter";
import { listSummary, matchingIds, MAX_SEARCH_LENGTH, noMatchMessage, type SearchEntry } from "../_lib/user-search";

type UserSearchState = {
  query: string;
  setQuery: (query: string) => void;
  /** The people the search leaves in the view, or null without a search: all of them. */
  matched: ReadonlySet<string> | null;
  /** The search box's id, so Clear Search in the list can put the keyboard back in it. */
  inputId: string;
};

/** Without a UserSearch around it (a lone table), nothing is searched. */
const UserSearchContext = createContext<UserSearchState>({
  query: "",
  setQuery: () => {},
  matched: null,
  inputId: "",
});

export function useUserSearch(): UserSearchState {
  return use(UserSearchContext);
}

/** Puts the search in the address, or takes it out, without a navigation. */
function keepSearchInAddress(query: string): void {
  const url = new URL(window.location.href);
  const trimmed = query.trim();
  if ((url.searchParams.get(SEARCH_PARAM) ?? "") === trimmed) return;
  if (trimmed) url.searchParams.set(SEARCH_PARAM, trimmed);
  else url.searchParams.delete(SEARCH_PARAM);
  // Next.js keeps its router in step with the History API (no server render).
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/** Holds the search for the box, the count and the rows inside it. */
export function UserSearch({
  entries,
  initialQuery,
  view,
  children,
}: {
  /** Everyone in the view, with what they are found by (userSearchText()). Drawn again on every server render. */
  entries: readonly SearchEntry[];
  /** The ?q= of the address the server drew the page for. */
  initialQuery: string;
  /** The view the Team picker shows (filterValue()). */
  view: string;
  children: ReactNode;
}) {
  const inputId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [shownView, setShownView] = useState(view);
  if (view !== shownView) {
    // Another view. The Team picker brings the search along in the address;
    // a link to a team comes without one, so the team shows whole.
    setShownView(view);
    if (!initialQuery.trim()) setQuery("");
  }
  const matched = useMemo(() => matchingIds(entries, query), [entries, query]);

  // After every keystroke, and every server render: a link that opened the
  // same view again, or a refresh after a change, may have left it out.
  useEffect(() => keepSearchInAddress(query), [query, entries]);

  const state = useMemo(() => ({ query, setQuery, matched, inputId }), [query, matched, inputId]);
  return <UserSearchContext value={state}>{children}</UserSearchContext>;
}

/**
 * The search box, beside the Team picker and labelled like it. 44 px tall on
 * touch, with Clear Search inside it (a 44 px hit area) while it holds text;
 * Escape clears it too.
 */
export function UserSearchBox({ placeholder }: { placeholder: string }) {
  const { query, setQuery, inputId } = useUserSearch();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <Label htmlFor={inputId}>Search</Label>
      <InputGroup className="w-72 max-w-full">
        <InputGroupAddon>
          <SearchIcon aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          id={inputId}
          type="search"
          value={query}
          placeholder={placeholder}
          maxLength={MAX_SEARCH_LENGTH}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              setQuery("");
            }
          }}
          enterKeyHint="search"
          autoComplete="off"
          autoCapitalize="none"
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
                setQuery("");
                // The button goes with the text; keep the keyboard in the box.
                document.getElementById(inputId)?.focus();
              }}
            >
              <XIcon aria-hidden />
            </InputGroupButton>
          </InputGroupAddon>
        )}
      </InputGroup>
    </div>
  );
}

/** What the list shows, in words, announced as the search changes it. */
export function UserSearchSummary({ filter, shown, total }: { filter: TeamFilter; shown: number; total: number }) {
  const { matched } = useUserSearch();
  return (
    <p className="text-sm text-muted-foreground tabular-nums" role="status">
      {listSummary(filter, shown, total, matched?.size ?? null)}
    </p>
  );
}

const EMPTY_CELL = "px-4 py-6 text-center whitespace-normal text-muted-foreground";

/**
 * The table's rows that the search leaves, in the list's order. With nobody
 * in the view, the view's own line; with nobody matching, a line that says
 * so and Clear Search, which puts the keyboard back in the search box.
 */
export function UserRows({
  rows,
  columns,
  emptyMessage,
  filter,
}: {
  rows: readonly { id: string; row: ReactNode }[];
  /** How many columns the table has, for the line's colSpan. */
  columns: number;
  emptyMessage: string;
  filter: TeamFilter;
}) {
  const { query, setQuery, matched, inputId } = useUserSearch();

  if (rows.length === 0) {
    return (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={columns} className={EMPTY_CELL}>
          {emptyMessage}
        </TableCell>
      </TableRow>
    );
  }

  const shown = matched ? rows.filter((entry) => matched.has(entry.id)) : rows;
  if (shown.length === 0) {
    return (
      <TableRow className="hover:bg-transparent" data-slot="no-match">
        <TableCell colSpan={columns} className={EMPTY_CELL}>
          <div className="flex flex-col items-center gap-3">
            <p>{noMatchMessage(filter, query)}</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setQuery("");
                // This button goes with the line; the search box takes the keyboard.
                document.getElementById(inputId)?.focus();
              }}
            >
              Clear Search
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return shown.map((entry) => <Fragment key={entry.id}>{entry.row}</Fragment>);
}
