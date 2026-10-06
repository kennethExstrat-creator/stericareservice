"use client";

import { useEffect, useMemo, useRef } from "react";
import { PlusIcon, TagsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { matchesSearch, searchText, type DefectCodeItem, type DefectsCounts } from "@/lib/admin/defects";
import { CodePanel } from "./code-panel";
import { CodesTable } from "./codes-table";
import { DefectsHeader } from "./defects-header";
import { EmptyState, NoMatches } from "./list-parts";
import { ListSearch, useQuery } from "./list-search";
import { usePanel } from "./panel";

function textOf(row: DefectCodeItem): string {
  return searchText(row.code, row.name, row.description, row.usedBy.join(" "), row.active ? "active" : "inactive");
}

function countText(shown: number, total: number, inactive: number): string {
  const codes = (count: number) => `${count.toLocaleString("en-GB")} ${count === 1 ? "code" : "codes"}`;
  if (shown !== total) return `${shown.toLocaleString("en-GB")} of ${codes(total)}`;
  return inactive > 0 ? `${codes(total)}, ${inactive.toLocaleString("en-GB")} inactive` : codes(total);
}

/** /admin/defects in the browser: the header, the code list, its search and the panel that adds and edits. */
export function DefectCodesAdmin({
  codes,
  counts,
  initialQuery,
  prefill,
}: {
  codes: DefectCodeItem[];
  counts: DefectsCounts;
  initialQuery: string;
  /** From a "Not a defect code" link on the label mapping tab: open the add panel filled in. */
  prefill: { code: string; name: string } | null;
}) {
  // Where the keyboard goes when a panel closes and what opened it has gone.
  const addButton = useRef<HTMLButtonElement>(null);
  const panel = usePanel(addButton, prefill ? { mode: "create", prefill } : null);
  const { query, setQuery } = useQuery(initialQuery);
  const indexed = useMemo(() => codes.map((row) => ({ row, text: textOf(row) })), [codes]);
  const results = useMemo(
    () => indexed.filter((entry) => matchesSearch(entry.text, query)).map((entry) => entry.row),
    [indexed, query],
  );

  // The link's values have done their job once the panel is open: a reload should not open it again.
  useEffect(() => {
    if (!prefill) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("add");
    url.searchParams.delete("name");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [prefill]);

  const editingCode = panel.target.mode === "edit" ? panel.target.code : null;
  const item = editingCode ? (codes.find((row) => row.code === editingCode) ?? null) : null;
  const add = (from: HTMLElement) => panel.show({ mode: "create" }, from);

  return (
    <div className="flex flex-col gap-6">
      <DefectsHeader
        current="codes"
        counts={counts}
        actions={
          <Button ref={addButton} onClick={(event) => add(event.currentTarget)}>
            <PlusIcon aria-hidden />
            Add code
          </Button>
        }
      />

      {codes.length === 0 ? (
        <EmptyState
          icon={<TagsIcon aria-hidden />}
          title="No defect codes yet"
          action={
            <Button variant="outline" onClick={(event) => add(event.currentTarget)}>
              Add your first code
            </Button>
          }
        >
          Add one code per defect. Templates then map their own labels to the codes, so the same defect counts together
          whatever each client calls it.
        </EmptyState>
      ) : (
        <>
          <ListSearch
            query={query}
            onQueryChange={setQuery}
            label="Search codes"
            placeholder="Search by code, name, description or template"
            count={countText(results.length, codes.length, codes.filter((row) => !row.active).length)}
          />
          {results.length > 0 ? (
            <CodesTable
              rows={results}
              selectedCode={panel.open ? editingCode : null}
              onEdit={(code, opener) => panel.show({ mode: "edit", code }, opener)}
            />
          ) : (
            <NoMatches query={query} many="codes" onClear={() => setQuery("")} />
          )}
        </>
      )}

      <CodePanel
        key={panel.key}
        open={panel.open}
        target={panel.target}
        item={item}
        onClose={panel.close}
        onDeleted={panel.closeDeleted}
        returnFocus={panel.returnFocus}
      />
    </div>
  );
}
