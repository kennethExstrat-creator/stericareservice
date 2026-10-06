"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { FlagIcon, InfoIcon } from "lucide-react";
import { InspectionStatusBadge } from "@/app/(app)/inspections/_components/inspection-status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInspectionDate } from "@/lib/inspections/format";
import type { SizeOption } from "@/lib/format";
import {
  canMap,
  countLabel,
  inspectionHref,
  placeLabel,
  templateVersionLabel,
  whereLabel,
  type InspectionLabels,
  type OneOffLabel,
} from "@/lib/admin/defects";
import { cn } from "@/lib/utils";
import { UnmappedBadge } from "./badges";
import { EmptyState } from "./list-parts";
import { MapLabelDialog, type CodeOption } from "./map-label-dialog";

// Compact rows with a mouse, about 36 px around the 32 px Map button; 44 px controls on touch.
const HEAD = "h-9 px-3 text-sm font-medium text-muted-foreground first:pl-4 last:pr-4 md:first:pl-5 md:last:pr-5 touch:h-11";
const CELL =
  "px-3 py-1.5 align-middle whitespace-normal first:pl-4 last:pr-4 md:first:pl-5 md:last:pr-5 fine:py-0.5 touch:py-2.5";

type Mapping = { inspection: InspectionLabels; label: OneOffLabel; headingId: string };

/**
 * The one-off labels on inspections that are not approved, one card per
 * inspection: where each came from (module and class, then each size and
 * hand with its count), with Map for a submitted inspection. A label counted
 * in several sizes is one row, mapped once.
 */
export function UnmappedView({ inspections, codes }: { inspections: InspectionLabels[]; codes: CodeOption[] }) {
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const trigger = useRef<HTMLElement | null>(null);

  if (inspections.length === 0) {
    return (
      <EmptyState icon={<FlagIcon aria-hidden />} title="No unmapped labels">
        When an inspector adds a defect that is not on the template&rsquo;s list, it is saved under their own words
        and shows here until an admin maps it to a code.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {inspections.map((inspection) => (
        <InspectionCard
          key={inspection.id}
          inspection={inspection}
          onMap={(label, button, headingId) => {
            trigger.current = button;
            setMapping({ inspection, label, headingId });
          }}
        />
      ))}
      {mapping && (
        <MapLabelDialog
          key={mapping.label.id}
          inspection={mapping.inspection}
          label={mapping.label}
          codes={codes}
          onClose={() => setMapping(null)}
          // Back to the Map button; once the label is mapped its row is gone, so to the inspection's heading.
          returnFocus={() => {
            const button = trigger.current;
            const target = button && document.contains(button) ? button : document.getElementById(mapping.headingId);
            target?.focus();
          }}
        />
      )}
    </div>
  );
}

const WAITING: Partial<Record<InspectionLabels["status"], string>> = {
  draft: "A draft: the inspector may still change these labels. They can be mapped once it is submitted.",
  reopened: "Reopened: the inspector may still change these labels. They can be mapped once it is submitted again.",
};

function InspectionCard({
  inspection,
  onMap,
}: {
  inspection: InspectionLabels;
  onMap: (label: OneOffLabel, button: HTMLElement, headingId: string) => void;
}) {
  const headingId = useId();
  const mappable = canMap(inspection.status);
  const waiting = WAITING[inspection.status];
  const facts = [
    inspection.template ? templateVersionLabel(inspection.template) : "Template unknown",
    formatInspectionDate(inspection.inspectionDate),
    inspection.inspector,
  ].filter(Boolean);

  return (
    <section
      aria-labelledby={headingId}
      data-ref={inspection.refNo}
      className="relative overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border"
    >
      <header className="flex flex-col gap-1.5 border-b border-border px-4 py-3 md:flex-row md:items-center md:justify-between md:gap-4 md:px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 id={headingId} tabIndex={-1} className="text-lg font-bold text-foreground outline-none">
            <Link
              href={inspectionHref(inspection.id, inspection.status)}
              className="rounded-sm text-brand-600 tabular-nums underline-offset-4 hover:underline focus-ring"
            >
              {inspection.refNo}
            </Link>
          </h2>
          <InspectionStatusBadge status={inspection.status} />
        </div>
        <p className="text-sm text-muted-foreground">{facts.join(" · ")}</p>
      </header>

      {waiting && (
        <p className="flex gap-2 border-b border-border bg-slate-50 px-4 py-2.5 text-sm text-muted-foreground md:px-5">
          <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {waiting}
        </p>
      )}

      <Table className="table-fixed text-sm touch:text-base">
        <caption className="sr-only">One-off labels on {inspection.refNo}</caption>
        <TableHeader className="bg-slate-50">
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className={HEAD}>
              Label
            </TableHead>
            <TableHead scope="col" className={cn(HEAD, "w-36 touch:w-40")}>
              Where
            </TableHead>
            <TableHead scope="col" className={cn(HEAD, "w-52 touch:w-56")}>
              Found
            </TableHead>
            {mappable && (
              <TableHead scope="col" className={cn(HEAD, "w-24 touch:w-28")}>
                <span className="sr-only">Action</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {inspection.labels.map((label) => (
            <TableRow key={label.id} data-label={label.label} data-kind={label.kind} className="hover:bg-transparent">
              <TableHead scope="row" className={cn(CELL, "h-auto font-normal touch:h-auto")}>
                {/* One line on desktop when it fits; the badge wraps under a long label. */}
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium text-foreground [overflow-wrap:anywhere]">{label.label}</span>
                  {/* An Other : hole already counts as hole_other: only one-off labels are flagged. */}
                  {label.kind === "unmapped" && <UnmappedBadge />}
                </span>
              </TableHead>
              <TableCell className={CELL}>{whereLabel(label)}</TableCell>
              <TableCell className={CELL}>
                <Found label={label} sizes={inspection.sizes} />
              </TableCell>
              {mappable && (
                <TableCell className={cn(CELL, "text-right")}>
                  {label.count === null ? (
                    <span className="text-sm text-muted-foreground">Fix the count first</span>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Map “${label.label}” on ${inspection.refNo}`}
                      onClick={(event) => onMap(label, event.currentTarget, headingId)}
                    >
                      Map
                    </Button>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

/**
 * Each size (and hand) the label was counted in, with its count, and the
 * total when there is more than one. A count that is not a whole number
 * shows as unreadable.
 */
function Found({ label, sizes }: { label: OneOffLabel; sizes: readonly SizeOption[] }) {
  const count = (value: number | null) =>
    value === null ? <span className="font-medium text-warn">unreadable</span> : <span className="tabular-nums">{value}</span>;
  return (
    <ul className="flex flex-col gap-0.5" data-found>
      {label.places.map((place) => (
        <li key={`${place.size}-${place.hand ?? ""}`}>
          {placeLabel(place, sizes)}: {count(place.count)}
        </li>
      ))}
      {label.places.length > 1 && (
        <li className="font-medium text-foreground">
          {label.count === null ? "Total unreadable" : `${countLabel(label.module, label.count)} in all`}
        </li>
      )}
    </ul>
  );
}
