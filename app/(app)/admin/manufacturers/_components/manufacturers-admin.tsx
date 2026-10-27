"use client";

import { useEffect, useMemo, useRef } from "react";
import { FactoryIcon, PlusIcon } from "lucide-react";
import { PageHeader } from "@/components/qc";
import { Button } from "@/components/ui/button";
import {
  countrySuggestions,
  factoryCount,
  indexManufacturers,
  searchManufacturers,
  type BrandItem,
} from "@/lib/admin/manufacturers";
import { BrandPanel } from "./brand-panel";
import { CompanyPanel } from "./company-panel";
import type { ManufacturerTarget } from "./edit-panel";
import { FactoryPanel } from "./factory-panel";
import { ManufacturersTable } from "./manufacturers-table";
import { EmptyList, NoMatches } from "./reference-list";
import { focusFirst, usePanel } from "./reference-panel";
import { ListSearch, useSearchQuery } from "./reference-search";

type Index = ReturnType<typeof indexManufacturers>;

/** Where a panel opened from, the places to try if that has gone, and when the panel closed. */
type Opening = { from: HTMLElement | null; places: string[]; closedAt: number | null };

/** How long after a panel closes the page's refresh may still take away the control the focus went back to. */
const REFRESH_GRACE_MS = 5000;

/**
 * The controls the keyboard may go back to when a panel closes and the one
 * it opened from has gone (data-opener in the table): the same control drawn
 * again (a company moved to another brand), then the one above it, such as
 * the company's pencil once its last factory is deleted.
 */
function returnPlaces(target: ManufacturerTarget, index: Index): string[] {
  switch (target.kind) {
    case "brand":
      return target.mode === "edit" ? [`edit-brand:${target.id}`] : [];
    case "company": {
      if (target.mode === "create") return [`add-company:${target.brandId}`, `edit-brand:${target.brandId}`];
      const brand = index.companies.get(target.id)?.brand;
      return [`edit-company:${target.id}`, ...(brand ? [`edit-brand:${brand.id}`] : [])];
    }
    case "factory": {
      if (target.mode === "create") return [`add-factory:${target.companyId}`, `edit-company:${target.companyId}`];
      const company = index.factories.get(target.id)?.company;
      return [`edit-factory:${target.id}`, ...(company ? [`edit-company:${company.id}`] : [])];
    }
  }
}

/** The focus back where the panel opened from, else on a place near it, else on `fallback` (Add Brand). */
function focusBack(opening: Opening, fallback: HTMLElement | null): void {
  const again = opening.places.map((place) => document.querySelector<HTMLElement>(`[data-opener="${place}"]`));
  focusFirst([opening.from, ...again, fallback]);
}

/**
 * /admin/manufacturers in the browser: the brands, their companies and
 * factories in one table, its search, and the panels that add and edit them.
 */
export function ManufacturersAdmin({ brands, initialQuery }: { brands: BrandItem[]; initialQuery: string }) {
  // Where the keyboard goes when a panel closes and every control it could go back to has gone.
  const addButton = useRef<HTMLButtonElement>(null);
  const { show, close, closeDeleted, ...panel } = usePanel<ManufacturerTarget>(addButton, { kind: "brand", mode: "create" });
  const { query, setQuery } = useSearchQuery(initialQuery);

  const index = useMemo(() => indexManufacturers(brands), [brands]);
  const shown = useMemo(() => searchManufacturers(brands, query), [brands, query]);
  const countries = useMemo(() => countrySuggestions(brands), [brands]);

  const opened = useRef<Opening>({ from: null, places: [], closedAt: null });
  function open(target: ManufacturerTarget, from: HTMLElement | null) {
    opened.current = { from, places: returnPlaces(target, index), closedAt: null };
    show(target, from);
  }
  function returnFocus() {
    focusBack(opened.current, addButton.current);
    opened.current.closedAt = Date.now();
  }

  // A save or delete refreshes the page, and the new list can arrive after
  // the panel has closed: when the control the focus went back to went with
  // the old list (Add Company, once the brand has a company; a deleted row's
  // pencil), the focus is on nothing, so look again in the new one.
  useEffect(() => {
    const opening = opened.current;
    if (opening.closedAt === null) return;
    const recent = Date.now() - opening.closedAt < REFRESH_GRACE_MS;
    opening.closedAt = null;
    if (recent && (document.activeElement === null || document.activeElement === document.body)) {
      focusBack(opening, addButton.current);
    }
  }, [brands]);

  const { target } = panel;
  const selected = panel.open && target.mode === "edit" ? { kind: target.kind, id: target.id } : null;
  const addBrand = (button: HTMLElement) => open({ kind: "brand", mode: "create" }, button);
  // Every opening gets a new key, so the form starts fresh.
  const panelProps = { open: panel.open, onClose: close, onDeleted: closeDeleted, returnFocus };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Admin"
        title="Manufacturers"
        actions={
          <Button ref={addButton} onClick={(event) => addBrand(event.currentTarget)}>
            <PlusIcon aria-hidden />
            Add Brand
          </Button>
        }
      />

      {brands.length === 0 ? (
        <EmptyList
          icon={<FactoryIcon aria-hidden />}
          title="No Manufacturers Yet"
          action={
            <Button variant="outline" onClick={(event) => addBrand(event.currentTarget)}>
              Add Your First Brand
            </Button>
          }
        />
      ) : (
        <>
          <ListSearch
            query={query}
            onQueryChange={setQuery}
            label="Search manufacturers"
            placeholder="Search by brand, company, factory or address"
            shown={factoryCount(shown)}
            total={factoryCount(brands)}
            noun={{ one: "factory", many: "factories" }}
          />
          {shown.length > 0 ? (
            <ManufacturersTable brands={shown} selected={selected} onOpen={open} />
          ) : (
            <NoMatches query={query} many="Manufacturers" onClear={() => setQuery("")} />
          )}
        </>
      )}

      {target.kind === "brand" && (
        <BrandPanel key={panel.key} {...panelProps} target={target} item={target.mode === "edit" ? (index.brands.get(target.id) ?? null) : null} />
      )}
      {target.kind === "company" && (
        <CompanyPanel
          key={panel.key}
          {...panelProps}
          target={target}
          item={target.mode === "edit" ? (index.companies.get(target.id)?.company ?? null) : null}
          brands={brands}
        />
      )}
      {target.kind === "factory" && (
        <FactoryPanel
          key={panel.key}
          {...panelProps}
          target={target}
          item={target.mode === "edit" ? (index.factories.get(target.id)?.factory ?? null) : null}
          companyName={target.mode === "edit" ? (index.factories.get(target.id)?.company.name ?? "") : ""}
          brands={brands}
          countries={countries}
        />
      )}
    </div>
  );
}
