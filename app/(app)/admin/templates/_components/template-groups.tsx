// Every template code with its versions (BUILD_SPEC 10, /admin/templates):
// one card per code, one row per version, newest first. Compact 36 px rows
// with a mouse; 44 px rows and 16 px text on touch (docs/DESIGN.md).
//
// The table never scrolls sideways. From 1280 px each scope part has its own
// column; below that the client and manufacturer fold under the product
// type, and in iPad portrait the base template folds there too.
import Link from "next/link";
import type { ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  formatDate,
  PRODUCT_TYPE_LABEL,
  STANDARD_LABEL,
  templatePath,
  usageText,
  type TemplateGroup,
  type TemplateVersionSummary,
} from "@/lib/admin/templates";
import { cn } from "@/lib/utils";
import { TemplateStatusBadge } from "./template-status-badge";

const HEAD = "h-9 px-3 text-sm font-medium text-muted-foreground first:pl-4 last:pr-4 fine:px-2.5 touch:h-11";
const CELL = "px-3 py-1.5 align-middle first:pl-4 last:pr-4 fine:px-2.5 touch:py-2.5 whitespace-normal";

/** One line with a mouse (the full text in the tooltip); up to two lines on touch. */
const LONG_TEXT = "block truncate touch:line-clamp-2 touch:whitespace-normal touch:break-words";

function clientText(version: TemplateVersionSummary): string {
  if (version.clientName) return version.clientName;
  return version.clientId ? "A client no longer listed" : "Any Client";
}

function manufacturerText(version: TemplateVersionSummary): string {
  if (version.manufacturerName) return version.manufacturerName;
  return version.manufacturerId ? "A manufacturer no longer listed" : "Any Manufacturer";
}

function Text({ children, muted = false }: { children: string; muted?: boolean }) {
  return (
    <span className={cn(LONG_TEXT, muted && "text-muted-foreground")} title={children}>
      {children}
    </span>
  );
}

/** A second line, on screens where the value has no column of its own. */
function Folded({ until, children }: { until: "lg" | "xl"; children: ReactNode }) {
  return (
    <span className={cn("mt-0.5 block text-sm text-muted-foreground", until === "lg" ? "lg:hidden" : "xl:hidden")}>
      {children}
    </span>
  );
}

function groupSummary(group: TemplateGroup): string {
  const count = `${group.versions.length} ${group.versions.length === 1 ? "version" : "versions"}`;
  return group.active ? `Version ${group.active.version} active · ${count}` : `No active version · ${count}`;
}

export function TemplateGroups({ groups }: { groups: TemplateGroup[] }) {
  return (
    <ul className="flex flex-col gap-6">
      {groups.map((group) => (
        <li key={group.code}>
          <TemplateGroupCard group={group} />
        </li>
      ))}
    </ul>
  );
}

function TemplateGroupCard({ group }: { group: TemplateGroup }) {
  const headingId = `template-${group.code}`;
  return (
    <section
      aria-labelledby={headingId}
      data-code={group.code}
      className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-border"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border px-4 py-3">
        <h2 id={headingId} className="font-display text-lg font-bold break-all text-foreground">
          {group.code}
        </h2>
        {group.name && <p className="min-w-0 text-sm text-muted-foreground">{group.name}</p>}
        <p className="text-sm text-muted-foreground tabular-nums sm:ml-auto">{groupSummary(group)}</p>
      </header>
      <Table className="table-fixed text-sm touch:text-base">
        <caption className="sr-only">Versions of {group.code}, newest first</caption>
        <TableHeader className="bg-slate-50">
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className={cn(HEAD, "w-26 touch:w-30")}>
              Version
            </TableHead>
            <TableHead scope="col" className={cn(HEAD, "w-28 touch:w-32")}>
              Status
            </TableHead>
            <TableHead scope="col" className={cn(HEAD, "xl:w-60")}>
              <span className="xl:hidden">Scope</span>
              <span className="hidden xl:inline">Product and Standard</span>
            </TableHead>
            <TableHead scope="col" className={cn(HEAD, "hidden xl:table-cell")}>
              Client
            </TableHead>
            <TableHead scope="col" className={cn(HEAD, "hidden xl:table-cell")}>
              Manufacturer
            </TableHead>
            <TableHead scope="col" className={cn(HEAD, "hidden w-32 lg:table-cell")}>
              Extends
            </TableHead>
            <TableHead scope="col" className={cn(HEAD, "w-32 touch:w-40")}>
              Used By
            </TableHead>
            <TableHead scope="col" className={cn(HEAD, "hidden w-28 xl:table-cell")}>
              Updated
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {group.versions.map((version) => (
            <VersionRow key={version.id} version={version} />
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

function VersionRow({ version }: { version: TemplateVersionSummary }) {
  const product = `${PRODUCT_TYPE_LABEL[version.productType]} · ${STANDARD_LABEL[version.standard]}`;
  return (
    <TableRow data-version={version.version} data-status={version.status}>
      <TableHead scope="row" className={cn(CELL, "h-auto font-normal touch:h-auto")}>
        <Link
          href={templatePath(version.id)}
          aria-label={`${version.code} Version ${version.version}`}
          className="inline-flex items-center rounded-sm font-semibold text-brand-600 tabular-nums underline-offset-4 hover:underline focus-ring touch:min-h-11"
        >
          Version {version.version}
        </Link>
      </TableHead>
      <TableCell className={CELL}>
        <TemplateStatusBadge status={version.status} />
      </TableCell>
      <TableCell className={CELL}>
        <Text>{product}</Text>
        <Folded until="xl">
          <span className={LONG_TEXT} title={`${clientText(version)} · ${manufacturerText(version)}`}>
            {clientText(version)} · {manufacturerText(version)}
          </span>
        </Folded>
        {version.extendsCode && <Folded until="lg">Extends {version.extendsCode}</Folded>}
      </TableCell>
      <TableCell className={cn(CELL, "hidden xl:table-cell")}>
        <Text muted={!version.clientName}>{clientText(version)}</Text>
      </TableCell>
      <TableCell className={cn(CELL, "hidden xl:table-cell")}>
        <Text muted={!version.manufacturerName}>{manufacturerText(version)}</Text>
      </TableCell>
      <TableCell className={cn(CELL, "hidden lg:table-cell")}>
        {version.extendsCode ? (
          <Text>{version.extendsCode}</Text>
        ) : (
          <>
            <span aria-hidden className="text-muted-foreground">
              —
            </span>
            <span className="sr-only">No base template</span>
          </>
        )}
      </TableCell>
      <TableCell className={cn(CELL, "tabular-nums", version.usage === 0 && "text-muted-foreground")}>
        {usageText(version.usage)}
      </TableCell>
      <TableCell className={cn(CELL, "hidden tabular-nums xl:table-cell")}>
        <time dateTime={version.updatedAt}>{formatDate(version.updatedAt)}</time>
      </TableCell>
    </TableRow>
  );
}
