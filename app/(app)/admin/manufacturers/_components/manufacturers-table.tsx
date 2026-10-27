"use client";

import type { ReactNode } from "react";
import { PencilIcon, PlusIcon } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  factoryTitle,
  manufacturerRows,
  type BrandItem,
  type CompanyItem,
  type FactoryItem,
  type ManufacturerKind,
} from "@/lib/admin/manufacturers";
import { oneLine } from "@/lib/admin/reference";
import { cn } from "@/lib/utils";
import type { ManufacturerTarget } from "./edit-panel";
import { HEAD, ListCard, NoValue, UsageText } from "./reference-list";

/** The brand, company or factory whose panel is open, marked in the table. */
export type SelectedCell = { kind: ManufacturerKind; id: string } | null;

/** Opens a panel; `from` gets the focus back when it closes. */
type OpenPanel = (target: ManufacturerTarget, from: HTMLElement) => void;

/*
 * Every cell holds one line a control tall, its text centred on it: 28 px
 * with a mouse, so a row is 36 px with 4 px above and below (docs/DESIGN.md,
 * Density), and 44 px on any touchscreen, where the row is the control. A
 * brand's or company's cell spans its rows with its name at the top.
 *
 * From 1280 px with a mouse the names keep to one line and the address takes
 * the width that is left, cut short: its column asks for the whole table
 * (`ADDRESS`) while its cells ask for none (max-width 0), so the other
 * columns get what they need first. Below that, and on every touchscreen,
 * the address is not shown and a long name wraps.
 */
const CELL = "py-1 align-top whitespace-normal touch:py-0";
const NAME_CELL = "xl:whitespace-nowrap";
const ADDRESS = "hidden xl:table-cell xl:w-full";
const TEXT = "py-1 touch:py-2.5";
const MARKED = "bg-muted";

/**
 * A quiet icon in the cell it acts on (Kenneth, 26 October 2026: "put the
 * edit icon into the table, not outside"), as the pencils in a measurement
 * grid: slate-600 until hovered or focused, then brand, its fill a circle;
 * 28 px with a mouse, 44 px on any touchscreen.
 */
const ICON_BUTTON =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-clip-content p-0.5 text-muted-foreground outline-none transition-colors hover:bg-brand-100 hover:text-brand-700 focus-visible:text-brand-700 focus-ring-inset active:bg-brand-200 touch:size-11 touch:p-1 [&_svg]:size-3.5 touch:[&_svg]:size-4";

/** Add Company or Add Factory in an empty cell, on one line: the icon lines up with the names above and below. */
const ADD_BUTTON =
  "relative -ml-2 inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 font-medium whitespace-nowrap text-brand-600 outline-none transition-colors hover:bg-brand-100 hover:text-brand-700 focus-ring-inset active:bg-brand-200 touch:h-11 touch:px-3 [&_svg]:size-3.5 touch:[&_svg]:size-4";

/**
 * The manufacturers, one row per factory under its company and brand. The
 * pencils and pluses sit in the cell they act on; no row opens on a click.
 * The address shows from 1280 px with a mouse (the panel shows it on an
 * iPad), so rows keep 44 px controls without scrolling sideways.
 */
export function ManufacturersTable({
  brands,
  selected,
  onOpen,
}: {
  brands: readonly BrandItem[];
  selected: SelectedCell;
  onOpen: OpenPanel;
}) {
  const marked = (kind: ManufacturerKind, id: string) => selected?.kind === kind && selected.id === id && MARKED;

  return (
    <ListCard>
      <Table className="touch:text-base">
        <caption className="sr-only">Manufacturers</caption>
        <TableHeader className="bg-slate-50">
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn("pl-4", HEAD)}>Brand</TableHead>
            <TableHead className={HEAD}>Company</TableHead>
            <TableHead className={HEAD}>Factory</TableHead>
            <TableHead className={cn(ADDRESS, HEAD)}>Address</TableHead>
            <TableHead className={cn("pr-4", HEAD)}>In Use</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {manufacturerRows(brands).map(({ key, brand, brandSpan, company, companySpan, factory }) => {
            const factoryMark = factory && marked("factory", factory.id);
            return (
              <TableRow key={key} className="hover:bg-transparent">
                {brandSpan > 0 && (
                  <TableCell rowSpan={brandSpan} className={cn("pl-4", CELL, NAME_CELL, marked("brand", brand.id))}>
                    <BrandCell brand={brand} onOpen={onOpen} />
                  </TableCell>
                )}

                {company === null ? (
                  <TableCell className={CELL}>
                    <AddButton
                      label="Add Company"
                      under={brand.name}
                      opener={`add-company:${brand.id}`}
                      onClick={(button) => onOpen({ kind: "company", mode: "create", brandId: brand.id }, button)}
                    />
                  </TableCell>
                ) : (
                  companySpan > 0 && (
                    <TableCell rowSpan={companySpan} className={cn(CELL, NAME_CELL, marked("company", company.id))}>
                      <CompanyCell company={company} onOpen={onOpen} />
                    </TableCell>
                  )
                )}

                <TableCell className={cn(CELL, NAME_CELL, factoryMark)}>
                  {company && !factory && (
                    <AddButton
                      label="Add Factory"
                      under={company.name}
                      opener={`add-factory:${company.id}`}
                      onClick={(button) => onOpen({ kind: "factory", mode: "create", companyId: company.id }, button)}
                    />
                  )}
                  {company && factory && <FactoryCell factory={factory} companyName={company.name} onOpen={onOpen} />}
                </TableCell>
                <TableCell className={cn(ADDRESS, "xl:max-w-0", CELL, factoryMark)}>
                  {factory && <AddressText factory={factory} />}
                </TableCell>
                <TableCell className={cn("pr-4", CELL, factoryMark)}>
                  {factory && (
                    <div className={TEXT}>
                      <UsageText usage={factory.usage} />
                    </div>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </ListCard>
  );
}

/** A name with the controls that act on it, which stay on its first line when a long name wraps. */
function NameLine({ children, controls }: { children: ReactNode; controls: ReactNode }) {
  return (
    <div className="flex items-start gap-1">
      <span className={cn("min-w-0 [overflow-wrap:anywhere]", TEXT)}>{children}</span>
      <span className="flex shrink-0 items-center">{controls}</span>
    </div>
  );
}

function BrandCell({ brand, onOpen }: { brand: BrandItem; onOpen: OpenPanel }) {
  return (
    <NameLine
      controls={
        <>
          <IconButton
            icon="edit"
            label={`Edit ${brand.name}`}
            opener={`edit-brand:${brand.id}`}
            onClick={(button) => onOpen({ kind: "brand", mode: "edit", id: brand.id }, button)}
          />
          {/* A brand with no company yet offers Add Company in its own cell instead. */}
          {brand.companies.length > 0 && (
            <IconButton
              icon="add"
              label={`Add Company to ${brand.name}`}
              opener={`add-company:${brand.id}`}
              onClick={(button) => onOpen({ kind: "company", mode: "create", brandId: brand.id }, button)}
            />
          )}
        </>
      }
    >
      <span className="font-medium text-foreground">{brand.name}</span>
    </NameLine>
  );
}

function CompanyCell({ company, onOpen }: { company: CompanyItem; onOpen: OpenPanel }) {
  return (
    <NameLine
      controls={
        <>
          <IconButton
            icon="edit"
            label={`Edit ${company.name}`}
            opener={`edit-company:${company.id}`}
            onClick={(button) => onOpen({ kind: "company", mode: "edit", id: company.id }, button)}
          />
          {company.factories.length > 0 && (
            <IconButton
              icon="add"
              label={`Add Factory to ${company.name}`}
              opener={`add-factory:${company.id}`}
              onClick={(button) => onOpen({ kind: "factory", mode: "create", companyId: company.id }, button)}
            />
          )}
        </>
      }
    >
      <span className="text-foreground">{company.name}</span>
    </NameLine>
  );
}

function FactoryCell({ factory, companyName, onOpen }: { factory: FactoryItem; companyName: string; onOpen: OpenPanel }) {
  return (
    <NameLine
      controls={
        <IconButton
          icon="edit"
          label={`Edit ${factoryTitle(factory.factoryName, companyName)}`}
          opener={`edit-factory:${factory.id}`}
          onClick={(button) => onOpen({ kind: "factory", mode: "edit", id: factory.id }, button)}
        />
      }
    >
      {factory.factoryName ?? <NoValue />}
    </NameLine>
  );
}

/** The address and country on one line, cut to the column; the whole of it on hover and in the panel. */
function AddressText({ factory }: { factory: FactoryItem }) {
  const text = [factory.address && oneLine(factory.address), factory.country].filter(Boolean).join(", ");
  if (!text) {
    return (
      <div className={TEXT}>
        <NoValue />
      </div>
    );
  }
  return (
    <div className={cn("truncate text-muted-foreground", TEXT)} title={text}>
      {text}
    </div>
  );
}

/**
 * `opener` marks the control (data-opener), so the keyboard can come back to
 * it when the panel closes, even after its row was drawn again.
 */
function IconButton({
  icon,
  label,
  opener,
  onClick,
}: {
  icon: "edit" | "add";
  label: string;
  opener: string;
  onClick: (button: HTMLButtonElement) => void;
}) {
  const Icon = icon === "edit" ? PencilIcon : PlusIcon;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-opener={opener}
      onClick={(event) => onClick(event.currentTarget)}
      className={ICON_BUTTON}
    >
      <Icon aria-hidden />
    </button>
  );
}

/** "Add Company" to the eye; "Add Company to Top Glove" to a screen reader. */
function AddButton({
  label,
  under,
  opener,
  onClick,
}: {
  label: string;
  under: string;
  opener: string;
  onClick: (button: HTMLButtonElement) => void;
}) {
  return (
    <button type="button" data-opener={opener} onClick={(event) => onClick(event.currentTarget)} className={ADD_BUTTON}>
      <PlusIcon aria-hidden />
      {label}
      <span className="sr-only"> to {under}</span>
    </button>
  );
}
