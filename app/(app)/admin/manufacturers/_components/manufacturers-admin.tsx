"use client";

import { useMemo, useRef, type MouseEvent } from "react";
import { FactoryIcon, PlusIcon } from "lucide-react";
import { PageHeader } from "@/components/qc";
import { Button } from "@/components/ui/button";
import { searchText, type ManufacturerItem } from "@/lib/admin/reference";
import { ManufacturerPanel } from "./manufacturer-panel";
import { ManufacturersTable } from "./manufacturers-table";
import { EmptyList, NoMatches } from "./reference-list";
import { usePanel } from "./reference-panel";
import { ListSearch, useListSearch } from "./reference-search";

/** Offered in the country field next to the countries already on the list. */
const COMMON_COUNTRIES = ["China", "India", "Indonesia", "Malaysia", "Sri Lanka", "Thailand", "Vietnam"];

const byName = new Intl.Collator("en-GB", { sensitivity: "base" });

function textOf(row: ManufacturerItem): string {
  return searchText(row.name, row.factoryName, row.country, row.address, row.notes);
}

/** Every country already used, then the common ones, without repeats. */
function countrySuggestions(rows: readonly ManufacturerItem[]): string[] {
  const seen = new Map<string, string>();
  for (const country of [...rows.map((row) => row.country), ...COMMON_COUNTRIES]) {
    if (country && !seen.has(country.toLowerCase())) seen.set(country.toLowerCase(), country);
  }
  return [...seen.values()].sort(byName.compare);
}

/** /admin/manufacturers in the browser: the list, its search and the panel that adds and edits. */
export function ManufacturersAdmin({
  manufacturers,
  initialQuery,
}: {
  manufacturers: ManufacturerItem[];
  initialQuery: string;
}) {
  // Where the keyboard goes when a panel closes and the button it opened from has gone.
  const addButton = useRef<HTMLButtonElement>(null);
  const panel = usePanel(addButton);
  const { query, setQuery, results } = useListSearch(manufacturers, initialQuery, textOf);
  const countries = useMemo(() => countrySuggestions(manufacturers), [manufacturers]);

  const editingId = panel.target.mode === "edit" ? panel.target.id : null;
  const item = editingId ? (manufacturers.find((row) => row.id === editingId) ?? null) : null;
  const add = (event: MouseEvent<HTMLButtonElement>) => panel.show({ mode: "create" }, event.currentTarget);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Admin"
        title="Manufacturers"
        actions={
          <Button ref={addButton} onClick={add}>
            <PlusIcon aria-hidden />
            Add manufacturer
          </Button>
        }
      />

      {manufacturers.length === 0 ? (
        <EmptyList
          icon={<FactoryIcon aria-hidden />}
          title="No manufacturers yet"
          description="Add the factories you inspect at, so templates and inspections can refer to them."
          action={
            <Button variant="outline" onClick={add}>
              Add your first manufacturer
            </Button>
          }
        />
      ) : (
        <>
          <ListSearch
            query={query}
            onQueryChange={setQuery}
            label="Search manufacturers"
            placeholder="Search by name, factory, country or address"
            shown={results.length}
            total={manufacturers.length}
            noun={{ one: "manufacturer", many: "manufacturers" }}
          />
          {results.length > 0 ? (
            <ManufacturersTable
              rows={results}
              selectedId={panel.open ? editingId : null}
              onEdit={(id, opener) => panel.show({ mode: "edit", id }, opener)}
            />
          ) : (
            <NoMatches query={query} many="manufacturers" onClear={() => setQuery("")} />
          )}
        </>
      )}

      <ManufacturerPanel
        key={panel.key}
        open={panel.open}
        target={panel.target}
        item={item}
        countries={countries}
        onClose={panel.close}
        onDeleted={panel.closeDeleted}
        returnFocus={panel.returnFocus}
      />
    </div>
  );
}
