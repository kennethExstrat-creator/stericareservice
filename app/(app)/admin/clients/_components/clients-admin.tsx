"use client";

import { useRef, type MouseEvent } from "react";
import { BuildingIcon, PlusIcon } from "lucide-react";
import { PageHeader } from "@/components/qc";
import { Button } from "@/components/ui/button";
import { searchText, type ClientItem } from "@/lib/admin/reference";
import { EmptyList, NoMatches } from "../../manufacturers/_components/reference-list";
import { usePanel } from "../../manufacturers/_components/reference-panel";
import { ListSearch, useListSearch } from "../../manufacturers/_components/reference-search";
import { ClientPanel } from "./client-panel";
import { ClientsTable } from "./clients-table";

function textOf(row: ClientItem): string {
  return searchText(row.name, row.notes);
}

/** /admin/clients in the browser: the list, its search and the panel that adds and edits. */
export function ClientsAdmin({ clients, initialQuery }: { clients: ClientItem[]; initialQuery: string }) {
  // Where the keyboard goes when a panel closes and the button it opened from has gone.
  const addButton = useRef<HTMLButtonElement>(null);
  const panel = usePanel(addButton);
  const { query, setQuery, results } = useListSearch(clients, initialQuery, textOf);

  const editingId = panel.target.mode === "edit" ? panel.target.id : null;
  const item = editingId ? (clients.find((row) => row.id === editingId) ?? null) : null;
  const add = (event: MouseEvent<HTMLButtonElement>) => panel.show({ mode: "create" }, event.currentTarget);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Admin"
        title="Clients"
        description="The companies you inspect for, with the logo for their reports."
        actions={
          <Button ref={addButton} onClick={add}>
            <PlusIcon aria-hidden />
            Add client
          </Button>
        }
      />

      {clients.length === 0 ? (
        <EmptyList
          icon={<BuildingIcon aria-hidden />}
          title="No clients yet"
          description="Add the companies you inspect for, with their logos, so templates and inspections can refer to them."
          action={
            <Button variant="outline" onClick={add}>
              Add your first client
            </Button>
          }
        />
      ) : (
        <>
          <ListSearch
            query={query}
            onQueryChange={setQuery}
            label="Search clients"
            placeholder="Search by name or notes"
            shown={results.length}
            total={clients.length}
            noun={{ one: "client", many: "clients" }}
          />
          {results.length > 0 ? (
            <ClientsTable
              rows={results}
              selectedId={panel.open ? editingId : null}
              onEdit={(id, opener) => panel.show({ mode: "edit", id }, opener)}
            />
          ) : (
            <NoMatches query={query} many="clients" onClear={() => setQuery("")} />
          )}
        </>
      )}

      <ClientPanel
        key={panel.key}
        open={panel.open}
        target={panel.target}
        item={item}
        onClose={panel.close}
        onCreated={(id) => panel.retarget({ mode: "edit", id })}
        onDeleted={panel.closeDeleted}
        returnFocus={panel.returnFocus}
      />
    </div>
  );
}
