"use client";

// Module Results as one-line rows that open (layout A, Kenneth, 27 October
// 2026): each module's title, its result per size as icons, its problems
// and its result; open, its sizes side by side, its problems and the
// inspector's comment. Modules with an error or warning, or a fail, start
// open; the rest are a line each. All / With Results / Information / Issues
// narrow the list, Expand All opens every row shown. A link to a row
// (#module-visual, from Needs Your Attention or elsewhere) opens it.
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDownIcon, CircleXIcon, TriangleAlertIcon } from "lucide-react";
import { StatusIcon, StatusPill } from "@/components/qc";
import { Button } from "@/components/ui/button";
import { STATUS_LABEL, STATUS_TEXT_CLASS, type Status } from "@/lib/design/status";
import { cn } from "@/lib/utils";

export type ModuleRowModel = {
  key: string;
  /** The row's id: "module-visual", "custom-site_notes". */
  anchor: string;
  title: string;
  /** With Results (a verdict) or Information (Info, or a custom module's fields). */
  group: "result" | "info";
  /** The module's result; a custom module shows `badge` instead. */
  status: Status | null;
  badge?: string;
  /** Its result per size, for modules judged per size. */
  sizes: { size: string; label: string; status: Status }[];
  errors: number;
  warnings: number;
  body: ReactNode;
};

type Filter = "all" | "result" | "info" | "issues";

function startsOpen(row: ModuleRowModel): boolean {
  return row.errors > 0 || row.warnings > 0 || row.status === "fail";
}

export function ModuleRows({ rows, children }: { rows: readonly ModuleRowModel[]; children?: ReactNode }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(rows.filter(startsOpen).map((row) => row.key)));

  // A link to a row opens it, shown whatever the filter, and brings it into view.
  useEffect(() => {
    const follow = () => {
      const anchor = decodeURIComponent(window.location.hash.slice(1));
      const row = rows.find((entry) => entry.anchor === anchor);
      if (!row) return;
      setFilter("all");
      setOpen((current) => (current.has(row.key) ? current : new Set([...current, row.key])));
      requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }));
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [rows]);

  const counts: Record<Filter, number> = {
    all: rows.length,
    result: rows.filter((row) => row.group === "result").length,
    info: rows.filter((row) => row.group === "info").length,
    issues: rows.filter((row) => row.errors + row.warnings > 0).length,
  };
  const filters: { value: Filter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "result", label: "With Results" },
    { value: "info", label: "Information" },
    ...(counts.issues > 0 ? [{ value: "issues" as const, label: "Issues" }] : []),
  ];
  const shown = rows.filter(
    (row) =>
      filter === "all" ||
      (filter === "issues" ? row.errors + row.warnings > 0 : row.group === filter),
  );
  const allOpen = shown.length > 0 && shown.every((row) => open.has(row.key));
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleAll = () =>
    setOpen((current) => {
      const next = new Set(current);
      for (const row of shown) {
        if (allOpen) next.delete(row.key);
        else next.add(row.key);
      }
      return next;
    });

  return (
    <section id="modules" aria-labelledby="modules-heading" className="rounded-xl bg-card shadow-sm ring-1 ring-border">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-4">
        <h2 id="modules-heading" className="text-lg leading-snug font-bold text-foreground">
          Module Results
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
            {filters.map((entry) => {
              const on = filter === entry.value;
              return (
                <button
                  key={entry.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFilter(entry.value)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold focus-ring touch:h-11 touch:px-4 touch:text-base",
                    on ? "border-brand-600 bg-brand-600 text-white" : "border-input bg-card text-foreground hover:bg-accent",
                  )}
                >
                  {entry.label}
                  <span className={cn("text-xs tabular-nums touch:text-sm", on ? "text-brand-100" : "text-muted-foreground")}>
                    {counts[entry.value]}
                  </span>
                </button>
              );
            })}
          </div>
          <Button type="button" variant="link" size="sm" onClick={toggleAll} className="px-2 touch:h-11">
            {allOpen ? "Collapse All" : "Expand All"}
          </Button>
        </div>
      </div>
      <ol className="divide-y divide-border border-t border-border">
        {shown.map((row) => (
          <Row key={row.key} row={row} open={open.has(row.key)} onToggle={() => toggle(row.key)} />
        ))}
      </ol>
      {children}
    </section>
  );
}

function Row({ row, open, onToggle }: { row: ModuleRowModel; open: boolean; onToggle: () => void }) {
  const bodyId = `${row.anchor}-body`;
  return (
    <li id={row.anchor} data-module={row.key} data-status={row.status ?? undefined} className={cn(open && "bg-slate-50/40")}>
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={onToggle}
          className="flex min-h-13 w-full flex-wrap items-center gap-x-3.5 gap-y-1.5 px-5 py-2.5 text-left focus-ring-inset hover:bg-slate-50 touch:min-h-14"
        >
          {row.status ? (
            <StatusIcon status={row.status} className={cn("size-[1.125rem] shrink-0", STATUS_TEXT_CLASS[row.status])} />
          ) : (
            <span aria-hidden className="size-[1.125rem] shrink-0" />
          )}
          <span className="min-w-0 flex-1 text-base font-semibold text-foreground fine:text-[0.9375rem]">{row.title}</span>
          {row.sizes.length > 0 && (
            <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              {row.sizes.map((size) => (
                <span
                  key={size.size}
                  title={`Size ${size.label}: ${STATUS_LABEL[size.status]}`}
                  className={cn("inline-flex items-center gap-1 text-sm font-semibold", STATUS_TEXT_CLASS[size.status])}
                >
                  <StatusIcon status={size.status} className="size-3.5" />
                  {size.label}
                  <span className="sr-only">: {STATUS_LABEL[size.status]}</span>
                </span>
              ))}
            </span>
          )}
          {row.errors > 0 && (
            <span className="inline-flex h-6 items-center gap-1 rounded-full border border-fail-border bg-fail-tint px-2 text-xs font-semibold text-fail touch:h-8 touch:text-sm">
              <CircleXIcon aria-hidden className="size-3.5" />
              {row.errors}
              <span className="sr-only"> {row.errors === 1 ? "error" : "errors"}</span>
            </span>
          )}
          {row.warnings > 0 && (
            <span className="inline-flex h-6 items-center gap-1 rounded-full border border-warn-border bg-warn-tint px-2 text-xs font-semibold text-warn touch:h-8 touch:text-sm">
              <TriangleAlertIcon aria-hidden className="size-3.5" />
              {row.warnings}
              <span className="sr-only"> {row.warnings === 1 ? "warning" : "warnings"}</span>
            </span>
          )}
          {row.status ? (
            <StatusPill status={row.status} size="sm" />
          ) : (
            row.badge && (
              <span className="inline-flex h-6 items-center rounded-full border border-slate-300 bg-card px-2 text-xs font-semibold text-slate-700 touch:h-8 touch:px-3 touch:text-base">
                {row.badge}
              </span>
            )
          )}
          <ChevronDownIcon
            aria-hidden
            className={cn("size-[1.125rem] shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          />
        </button>
      </h3>
      {open && (
        <div id={bodyId} className="px-5 pt-1 pb-5 sm:pl-[3.25rem]">
          {row.body}
        </div>
      )}
    </li>
  );
}
