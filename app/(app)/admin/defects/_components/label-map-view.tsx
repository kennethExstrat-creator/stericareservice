"use client";

import { useId, useMemo } from "react";
import Link from "next/link";
import { ArrowRightIcon, CircleCheckIcon, LayoutTemplateIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DEFECT_CLASSES, type DefectClass } from "@/lib/coverage/keys";
import { AQL_DEFAULTS } from "@/modules/_framework/context";
import {
  CLASS_LABEL,
  SECTION_TITLE,
  TEMPLATES_PATH,
  addCodeHref,
  filterLabelMaps,
  labelCount,
  listOf,
  templateEditorHref,
  type LabelRow,
  type LabelSection,
  type TemplateLabelMap,
} from "@/lib/admin/defects";
import { cn } from "@/lib/utils";
import { CodeProblemBadge, TemplateStatusBadge } from "./badges";
import { EmptyState, NoMatches } from "./list-parts";
import { ListSearch, useQuery } from "./list-search";

const HEAD = "h-9 px-3 text-sm font-medium text-muted-foreground first:pl-4 last:pr-4 md:first:pl-5 md:last:pr-5 touch:h-11";
const CELL = "px-3 py-1.5 align-middle whitespace-normal first:pl-4 last:pr-4 md:first:pl-5 md:last:pr-5 touch:py-2.5";

/** "0.0", "2.5", "4.0": as the reports print an AQL. */
function aqlText(aql: number): string {
  return aql.toFixed(1);
}

/** "AQL 2.5"; a class that leaves it empty takes the client's AQL, else BUILD_SPEC 7's default. */
function classAqlText(defectClass: DefectClass, aql: number | null): string {
  return aql === null ? `AQL from the client, else ${aqlText(AQL_DEFAULTS[defectClass])}` : `AQL ${aqlText(aql)}`;
}

function countText(shown: number, total: number): string {
  const labels = (count: number) => `${count.toLocaleString("en-GB")} ${count === 1 ? "label" : "labels"}`;
  return shown === total ? labels(total) : `${shown.toLocaleString("en-GB")} of ${labels(total)}`;
}

/**
 * Every template's defect labels, each with the code it counts as and, for
 * visual defects, its class: the severity in that template (BUILD_SPEC 4.2
 * rule 4). Read from each template's resolved definition; templates are
 * changed in the template editor.
 */
export function LabelMapView({ maps, initialQuery }: { maps: TemplateLabelMap[]; initialQuery: string }) {
  const { query, setQuery } = useQuery(initialQuery);
  const shown = useMemo(() => filterLabelMaps(maps, query), [maps, query]);

  if (maps.length === 0) {
    return (
      <EmptyState
        icon={<LayoutTemplateIcon aria-hidden />}
        title="No templates yet"
        action={
          <Button asChild variant="outline">
            <Link href={TEMPLATES_PATH}>Go to templates</Link>
          </Button>
        }
      >
        Each template&rsquo;s defect labels and the codes they map to appear here once templates are built in the
        template editor.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ListSearch
        query={query}
        onQueryChange={setQuery}
        label="Search labels"
        placeholder="Search by label, code, class or template"
        count={countText(labelCount(shown), labelCount(maps))}
      />
      {shown.length === 0 ? (
        <NoMatches query={query} many="labels" onClear={() => setQuery("")} />
      ) : (
        shown.map((map) => <TemplateCard key={map.id} map={map} />)
      )}
    </div>
  );
}

function TemplateCard({ map }: { map: TemplateLabelMap }) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      data-template={map.code}
      className="relative overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border"
    >
      <header className="flex flex-col gap-3 border-b border-border px-4 py-4 md:flex-row md:items-start md:justify-between md:px-5">
        <div className="min-w-0 space-y-1">
          <h2 id={titleId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-lg font-bold text-foreground">
            <span className="[overflow-wrap:anywhere]">
              {map.code} <span className="font-semibold text-muted-foreground">v{map.version}</span>
            </span>
            <TemplateStatusBadge status={map.status} />
          </h2>
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{map.name}</p>
        </div>
        <Button asChild variant="outline" size="sm" className="self-start">
          <Link href={templateEditorHref(map.id)} aria-label={`Open ${map.code} v${map.version} in the template editor`}>
            Open in template editor
            <ArrowRightIcon aria-hidden />
          </Link>
        </Button>
      </header>

      {map.resolved && <AttentionLine map={map} />}

      {!map.resolved ? (
        <p className="px-4 py-5 text-sm text-muted-foreground md:px-5">
          This version has not resolved yet, so its labels cannot be read. Fix it in the template editor.
        </p>
      ) : map.sections.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground md:px-5">
          No defect lists: this template has no visual inspection, watertight test or Safedon dispensing check.
        </p>
      ) : (
        map.sections.map(({ section, rows }) => (
          <SectionTable key={section} map={map} section={section} rows={rows} />
        ))
      )}

      {map.classesOff.length > 0 && (
        <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground md:px-5">
          Switched off in this template: {listOf(map.classesOff.map((defectClass) => `${CLASS_LABEL[defectClass].toLowerCase()} defects`))}.
        </p>
      )}
    </section>
  );
}

/** Whether every label counts as an active code, or how many need the admin. */
function AttentionLine({ map }: { map: TemplateLabelMap }) {
  if (map.attention === 0) {
    return (
      <p className="flex items-center gap-2 px-4 pt-3 text-sm text-muted-foreground md:px-5">
        <CircleCheckIcon aria-hidden className="size-4 shrink-0 text-slate-500" />
        Every label maps to an active defect code.
      </p>
    );
  }
  return (
    <p className="mx-4 mt-3 flex gap-2 rounded-lg border border-warn-border bg-warn-tint px-3 py-2 text-sm text-warn md:mx-5">
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>
        {map.attention === 1 ? "1 label needs" : `${map.attention} labels need`} attention: add the missing codes on the
        Codes tab, or change the template in the template editor.
      </span>
    </p>
  );
}

function SectionTable({ map, section, rows }: { map: TemplateLabelMap; section: LabelSection; rows: LabelRow[] }) {
  const headingId = useId();
  // Visual defects in a group per class, with the class's AQL: the class is the severity.
  const groups: { defectClass: DefectClass | null; rows: LabelRow[] }[] =
    section === "visual"
      ? DEFECT_CLASSES.flatMap((defectClass) => {
          const inClass = rows.filter((row) => row.defectClass === defectClass);
          return inClass.length > 0 ? [{ defectClass, rows: inClass }] : [];
        })
      : [{ defectClass: null, rows }];

  return (
    <div className="pt-4" data-section={section}>
      <h3 id={headingId} className="px-4 pb-2 text-base font-semibold text-foreground md:px-5">
        {SECTION_TITLE[section]}
      </h3>
      <Table aria-labelledby={headingId} className="table-fixed text-sm touch:text-base">
        <TableHeader className="bg-slate-50">
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className={HEAD}>
              Label on this template
            </TableHead>
            <TableHead scope="col" className={cn(HEAD, "w-[38%] md:w-[30%]")}>
              Defect code
            </TableHead>
            <TableHead scope="col" className={cn(HEAD, "hidden w-[30%] md:table-cell")}>
              Code name
            </TableHead>
          </TableRow>
        </TableHeader>
        {groups.map(({ defectClass, rows: groupRows }) => (
          <TableBody key={defectClass ?? "all"} data-class={defectClass ?? undefined}>
            {defectClass && (
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                <TableHead colSpan={3} scope="rowgroup" className={cn(CELL, "h-auto font-semibold text-foreground")}>
                  {CLASS_LABEL[defectClass]} defects
                  {map.classAql[defectClass] !== undefined && (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · {classAqlText(defectClass, map.classAql[defectClass] ?? null)}
                    </span>
                  )}
                </TableHead>
              </TableRow>
            )}
            {groupRows.map((row, index) => (
              <LabelTableRow key={`${row.code}-${index}`} row={row} />
            ))}
          </TableBody>
        ))}
      </Table>
    </div>
  );
}

function LabelTableRow({ row }: { row: LabelRow }) {
  const problem = row.state === "ok" ? null : row.state;
  return (
    <TableRow data-code={row.code} data-state-code={row.state}>
      <TableCell className={CELL}>
        <span className="font-medium text-foreground [overflow-wrap:anywhere]">{row.label}</span>
      </TableCell>
      <TableCell className={CELL}>
        <div className="flex flex-col items-start gap-1">
          <span className="font-mono text-[0.8125rem] [overflow-wrap:anywhere] touch:text-sm">{row.code}</span>
          {problem && <CodeProblemBadge state={problem} />}
          {/* Below 768 px the code name has no column: it goes under the code. */}
          <span className="text-sm text-muted-foreground md:hidden">{row.codeName}</span>
        </div>
      </TableCell>
      <TableCell className={cn(CELL, "hidden md:table-cell")}>
        {row.state === "unknown" ? (
          <Button asChild variant="link" size="sm" className="h-auto px-0 touch:h-11 touch:px-0">
            {/* The name says which code; it starts with the words on screen (WCAG 2.5.3). */}
            <Link href={addCodeHref(row.code, row.label)} aria-label={`Add this code: ${row.code}`}>
              <PlusIcon aria-hidden />
              Add this code
            </Link>
          </Button>
        ) : (
          <span className="text-foreground [overflow-wrap:anywhere]">{row.codeName}</span>
        )}
      </TableCell>
    </TableRow>
  );
}
