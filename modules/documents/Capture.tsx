"use client";

// Documents capture (BUILD_SPEC 6.1 documents): one row per item the
// template switches on, in its order. Verified, not verified or NA is a tap;
// the reference no. is typed; the expiry date comes from the date picker
// (6.2 rule 3). The item being worked on is reported as the focus, so a photo
// or file added now is tagged with it (BUILD_SPEC 8.1). Each row's chip is
// calc's result for the item; every change goes through useDataUpdater,
// built from the latest data (edit.ts).
import { useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Status } from "@/lib/design/status";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Figure,
  findIssue,
  issuePathProps,
  StatusPill,
  useDataUpdater,
  useIssueFocus,
  type IssuePath,
} from "@/components/qc";
import { SMALL_PILL_TOUCH } from "@/components/qc/status-pill";
import {
  labelFor,
  type CaptureFocus,
  type CaptureProps,
  type Labels,
  type ValidationIssue,
} from "@/modules/_framework";
import type { DocumentsComputed } from "./calc";
import {
  checklist,
  DOCUMENT_STATUSES,
  DocumentStatusSchema,
  type DocumentItem,
  type DocumentItemConfig,
  type DocumentsConfig,
  type DocumentStatus,
} from "./config";
import { withItemValues } from "./edit";
import type { DocumentEntry, DocumentsData } from "./schema";

/**
 * The focus for photo and file tags. CaptureFocus has no slot yet for an
 * entry of a module's own list, so `item` rides along until the framework
 * and lib/photos take it (handed over as a follow-up).
 */
type ItemFocus = CaptureFocus & { readonly item: string };

function itemFocus(item: DocumentItem): CaptureFocus {
  const focus: ItemFocus = { item };
  return focus;
}

const SELECTED_STATUS: Readonly<Record<DocumentStatus, string>> = {
  verified: "data-[state=on]:border-pass-border data-[state=on]:bg-pass-tint data-[state=on]:text-pass",
  not_verified: "data-[state=on]:border-fail-border data-[state=on]:bg-fail-tint data-[state=on]:text-fail",
  na: "data-[state=on]:border-info-border data-[state=on]:bg-info-tint data-[state=on]:text-info",
};

export default function Capture({
  data,
  config,
  title,
  labels,
  evaluation,
  focusPath,
  readOnly,
  onChange,
  onFocusChange,
}: CaptureProps<DocumentsData, DocumentsConfig, DocumentsComputed>) {
  const update = useDataUpdater(data, onChange);
  const items = checklist(config);
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<DocumentItem | null>(null);
  useIssueFocus(focusPath, { root });

  const focusItem = (key: DocumentItem) => {
    setActive(key);
    onFocusChange?.(itemFocus(key));
  };
  // Empty when the module could not be evaluated (invalid data or config), whatever its type says.
  const computed: Partial<DocumentsComputed> | undefined = evaluation?.computed;

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground touch:text-base">No documents are switched on for this template.</p>;
  }

  return (
    <div
      ref={root}
      className="overflow-clip rounded-lg border border-border bg-card xl:grid xl:grid-cols-[minmax(12rem,1fr)_auto_minmax(9rem,12rem)_10.5rem] xl:gap-x-4"
    >
      {/* From 1280 px each item is one row: the columns get headings (each control has its own name). */}
      <div
        aria-hidden
        className="hidden border-b border-border px-4 py-2 text-sm font-medium text-muted-foreground xl:col-span-full xl:grid xl:grid-cols-subgrid"
      >
        <span>{title}</span>
        <span>{labelFor(labels, "status")}</span>
        <span>{labelFor(labels, "referenceNo")}</span>
        <span>{labelFor(labels, "expiryDate")}</span>
      </div>
      <ul className="divide-y divide-border xl:col-span-full xl:grid xl:grid-cols-subgrid">
        {items.map((item) => (
          <DocumentRow
            key={item.key}
            item={item}
            entry={data.items[item.key]}
            status={computed?.itemStatus?.[item.key] ?? "not_done"}
            expired={computed?.expired?.[item.key] ?? null}
            labels={labels}
            issues={evaluation?.issues}
            active={active === item.key}
            readOnly={readOnly}
            onFocusItem={() => focusItem(item.key)}
            onUpdate={(values) => update((current) => withItemValues(current, item.key, values))}
          />
        ))}
      </ul>
    </div>
  );
}

function DocumentRow({
  item,
  entry,
  status,
  expired,
  labels,
  issues,
  active,
  readOnly,
  onFocusItem,
  onUpdate,
}: {
  item: DocumentItemConfig;
  entry: DocumentEntry;
  /** calc's result for the item. */
  status: Status;
  expired: boolean | null;
  labels: Labels;
  issues: readonly ValidationIssue[] | undefined;
  active: boolean;
  readOnly: boolean;
  onFocusItem: () => void;
  onUpdate: (values: Partial<DocumentEntry>) => void;
}) {
  const uid = useId();
  const name = labelFor(labels, item.key);
  const path = (field: keyof DocumentEntry): IssuePath => ["items", item.key, field];
  const expiryIssue = findIssue(issues, path("expiryDate"));

  return (
    <li
      data-active={active || undefined}
      className="space-y-3 px-4 py-3 data-active:bg-accent xl:col-span-full xl:grid xl:grid-cols-subgrid xl:items-start xl:gap-y-2 xl:space-y-0 xl:py-2.5"
      onFocus={onFocusItem}
      onPointerDown={onFocusItem}
      {...issuePathProps(["items", item.key])}
    >
      <div className="flex items-start justify-between gap-3 xl:flex-col xl:justify-start xl:gap-1">
        <div className="min-w-0 space-y-1">
          <p id={`${uid}-name`} className="font-semibold text-foreground touch:text-base">
            {name}
          </p>
          {item.required && (
            <Badge variant="secondary" className="touch:h-8 touch:px-3 touch:text-base">
              {labelFor(labels, "required")}
            </Badge>
          )}
        </div>
        <StatusPill size="sm" status={status} label={chipLabel(status, entry, labels)} className={SMALL_PILL_TOUCH} />
      </div>

      <div className="space-y-1.5" {...issuePathProps(path("status"))}>
        <span id={`${uid}-status`} className="text-sm font-medium touch:text-base xl:sr-only">
          {labelFor(labels, "status")}
        </span>
        {readOnly ? (
          <p className="font-medium touch:text-base">
            {entry.status === null ? <Figure value={null} /> : labelFor(labels, "status", entry.status)}
          </p>
        ) : (
          <ToggleGroup
            type="single"
            variant="outline"
            spacing={1}
            value={entry.status ?? ""}
            onValueChange={(next) => {
              const parsed = DocumentStatusSchema.safeParse(next);
              onUpdate({ status: parsed.success ? parsed.data : null });
            }}
            aria-labelledby={`${uid}-name ${uid}-status`}
            className="w-full flex-wrap xl:w-auto xl:flex-nowrap"
          >
            {DOCUMENT_STATUSES.map((value) => (
              <ToggleGroupItem
                key={value}
                value={value}
                className={cn(
                  "flex-1 rounded-full px-3 data-[state=on]:font-semibold touch:text-base xl:flex-none",
                  SELECTED_STATUS[value],
                )}
              >
                {labelFor(labels, "status", value)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:contents">
        <div className="space-y-1.5" {...issuePathProps(path("referenceNo"))}>
          <Label htmlFor={`${uid}-reference`} className="touch:text-base xl:sr-only">
            {labelFor(labels, "referenceNo")}
          </Label>
          <Input
            id={`${uid}-reference`}
            aria-label={`${labelFor(labels, "referenceNo")}, ${name}`}
            value={entry.referenceNo ?? ""}
            onChange={(event) => onUpdate({ referenceNo: event.target.value === "" ? null : event.target.value })}
            readOnly={readOnly}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder={readOnly ? undefined : labelFor(labels, "referenceNo")}
          />
        </div>
        <div className="space-y-1.5" {...issuePathProps(path("expiryDate"))}>
          <Label htmlFor={`${uid}-expiry`} className="touch:text-base xl:sr-only">
            {labelFor(labels, "expiryDate")}
          </Label>
          <Input
            id={`${uid}-expiry`}
            type="date"
            aria-label={`${labelFor(labels, "expiryDate")}, ${name}`}
            aria-describedby={expiryIssue ? `${uid}-expiry-issue` : undefined}
            value={entry.expiryDate ?? ""}
            onChange={(event) => onUpdate({ expiryDate: event.target.value === "" ? null : event.target.value })}
            readOnly={readOnly}
            className={cn(expired === true && "border-warn-solid")}
          />
          {expiryIssue && (
            <p
              id={`${uid}-expiry-issue`}
              className={cn("text-sm touch:text-base", expiryIssue.level === "error" ? "text-fail" : "text-warn")}
            >
              {expiryIssue.message}
            </p>
          )}
        </div>
      </div>

      {active && !readOnly && (
        <p className="text-sm text-muted-foreground touch:text-base xl:col-span-full">
          Photos and files added now are tagged “{name}”.
        </p>
      )}
    </li>
  );
}

/**
 * The chip's words for calc's result: the item's status in the template's
 * wording, "Expired" for a warning. While calc catches up with a tap, a word
 * that does not fit its verdict gives way to the verdict's own word.
 */
function chipLabel(status: Status, entry: DocumentEntry, labels: Labels): string | undefined {
  if (status === "warn") return labelFor(labels, "expired");
  if (entry.status === null) return undefined;
  const fits = status === "pass" ? entry.status === "verified" : (status === "fail" || status === "info") && entry.status !== "verified";
  return fits ? labelFor(labels, "status", entry.status) : undefined;
}
