"use client";

import { useId, useMemo, useRef, type ReactNode } from "react";
import { BookAIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { matchesSearch, type DefectsCounts } from "@/lib/admin/defects";
import { SHORTFORM_MESSAGES, type LibraryCode, type ShortformItem } from "@/lib/admin/shortforms";
import { sameShortform, type GlossaryStorage } from "@/lib/schemas/ai-settings";
import { DefectsHeader } from "./defects-header";
import { EmptyState, NoMatches } from "./list-parts";
import { ListSearch, useQuery } from "./list-search";
import { usePanel, type ShortformTarget } from "./panel";
import { ShortformPanel } from "./shortform-panel";
import { ShortformsTable } from "./shortforms-table";

function countText(shown: number, total: number): string {
  const shortforms = (count: number) => `${count.toLocaleString("en-GB")} ${count === 1 ? "shortform" : "shortforms"}`;
  return shown === total ? shortforms(total) : `${shown.toLocaleString("en-GB")} of ${shortforms(total)}`;
}

const COUNT =
  "inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-border bg-slate-100 px-1.5 text-xs font-semibold text-slate-700 tabular-nums";

/** A titled group of the list: Defects, Other Terms. */
function Section({ title, count, note, children }: { title: string; count: number; note?: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3" data-section={title}>
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className="flex items-center gap-2 text-lg leading-tight font-bold text-foreground">
          {title}
          <span className={COUNT}>{count}</span>
        </h2>
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * /admin/defects/shortforms in the browser: the header, the list (defects
 * with their codes, then the other terms), its search and the panel that
 * adds and edits one shortform.
 */
export function ShortformsAdmin({
  items,
  library,
  counts,
  storage,
  initialQuery,
}: {
  items: ShortformItem[];
  /** Every defect code, by name: the panel's picker offers the active ones. */
  library: LibraryCode[];
  counts: DefectsCounts;
  storage: GlossaryStorage;
  initialQuery: string;
}) {
  // Where the keyboard goes when a panel closes and what opened it has gone.
  const addButton = useRef<HTMLButtonElement>(null);
  const panel = usePanel<ShortformTarget>(addButton);
  const { query, setQuery } = useQuery(initialQuery);
  const results = useMemo(() => items.filter((item) => matchesSearch(item.search, query)), [items, query]);
  const defects = results.filter((item) => item.kind === "defect");
  const terms = results.filter((item) => item.kind === "term");
  const disabled = storage !== "ready";

  const editing = panel.target.mode === "edit" ? panel.target.short : null;
  const item = editing ? (items.find((entry) => sameShortform(entry.short, editing)) ?? null) : null;
  const add = (from: HTMLElement) => panel.show({ mode: "create" }, from);
  const edit = (short: string, opener: HTMLElement | null) => panel.show({ mode: "edit", short }, opener);
  const selected = panel.open ? editing : null;

  return (
    <div className="flex flex-col gap-6">
      <DefectsHeader
        current="shortforms"
        counts={counts}
        actions={
          <Button ref={addButton} disabled={disabled} onClick={(event) => add(event.currentTarget)}>
            <PlusIcon aria-hidden />
            Add Shortform
          </Button>
        }
      />
      <p className="max-w-3xl text-base text-muted-foreground">
        What inspectors write on their paper forms. Steri-AI reads every form with this list and counts each defect
        under its linked code.
      </p>

      {disabled && (
        <Alert className="border-warn-border bg-warn-tint text-warn">
          <TriangleAlertIcon aria-hidden />
          <AlertDescription className="text-warn">
            {storage === "no_secret_key"
              ? SHORTFORM_MESSAGES.noSecretKey
              : "The shortforms could not be read. Reload the page to try again."}
          </AlertDescription>
        </Alert>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={<BookAIcon aria-hidden />}
          title="No Shortforms Yet"
          action={
            <Button variant="outline" disabled={disabled} onClick={(event) => add(event.currentTarget)}>
              Add Your First Shortform
            </Button>
          }
        >
          Add what inspectors write for a defect or a term, such as BF for a hole between the fingers.
        </EmptyState>
      ) : (
        <>
          <ListSearch
            query={query}
            onQueryChange={setQuery}
            label="Search shortforms"
            placeholder="Search by shortform, meaning or code"
            count={countText(results.length, items.length)}
          />
          {results.length === 0 ? (
            <NoMatches query={query} many="Shortforms" onClear={() => setQuery("")} />
          ) : (
            <>
              {defects.length > 0 && (
                <Section title="Defects" count={defects.length}>
                  <ShortformsTable kind="defect" rows={defects} selected={selected} disabled={disabled} onEdit={edit} />
                </Section>
              )}
              {terms.length > 0 && (
                <Section title="Other Terms" count={terms.length} note="Not defects: tests, product words and factory codes.">
                  <ShortformsTable kind="term" rows={terms} selected={selected} disabled={disabled} onEdit={edit} />
                </Section>
              )}
            </>
          )}
        </>
      )}

      <ShortformPanel
        key={panel.key}
        open={panel.open}
        target={panel.target}
        item={item}
        library={library}
        onClose={panel.close}
        onDeleted={panel.closeDeleted}
        returnFocus={panel.returnFocus}
      />
    </div>
  );
}
