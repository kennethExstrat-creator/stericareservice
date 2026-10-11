"use client";

// Documents capture (BUILD_SPEC 6.1 documents): one row per item the
// template switches on, in its order. Verified, not verified or NA is a tap;
// the reference no. is typed; the expiry date comes from the date picker
// (6.2 rule 3). The row being worked on is reported as the focus
// (CaptureFocus.item). Files are linked by Steri-AI, never here: each
// certificate or report it reads on Source Documents goes to its row, where
// nothing is kept yet (readSourceFile; Kenneth, 12 October 2026). A row that
// keeps a file says so on the kit's attachment line, with the screen's file
// slot in it: the file's name, Preview and Unlink. While no row keeps one,
// one line under the list says what Steri-AI is doing ("No documents
// detected by Steri-AI."). Each row's chip, and the colour of its selected
// status, is calc's result for the item; every change goes through
// useDataUpdater, built from the latest data (edit.ts).
import { useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Status } from "@/lib/design/status";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  AttachmentStatus,
  DateField,
  Figure,
  findIssue,
  issuePathProps,
  StatusPill,
  useDataUpdater,
  useIssueFocus,
  type IssuePath,
} from "@/components/qc";
import {
  fieldIssues,
  heldFileState,
  labelFor,
  type CaptureFocus,
  type CaptureProps,
  type HeldFileState,
  type Labels,
  type ValidationIssue,
} from "@/modules/_framework";
import { ModuleFileSlot, useFileSlotRenderer } from "@/modules/_framework/file-slot";
import type { DocumentsComputed } from "./calc";
import {
  checklist,
  DOCUMENT_FILE_KIND,
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
 * The selected status wears calc's result for the item, as the chip beside
 * it does: red only where the item fails (a required item not verified), so
 * "Not verified" on an optional item stays neutral. While calc is still a
 * tap behind, the toggle keeps its own selected look.
 */
const SELECTED_TONE: Readonly<Partial<Record<Status, string>>> = {
  pass: "data-[state=on]:border-pass-border data-[state=on]:bg-pass-tint data-[state=on]:text-pass",
  fail: "data-[state=on]:border-fail-border data-[state=on]:bg-fail-tint data-[state=on]:text-fail",
  warn: "data-[state=on]:border-warn-border data-[state=on]:bg-warn-tint data-[state=on]:text-warn",
  info: "data-[state=on]:border-info-border data-[state=on]:bg-info-tint data-[state=on]:text-info",
};

export default function Capture({
  data,
  config,
  title,
  labels,
  context,
  evaluation,
  focusPath,
  readOnly,
  focus,
  onChange,
  onFocusChange,
}: CaptureProps<DocumentsData, DocumentsConfig, DocumentsComputed>) {
  const update = useDataUpdater(data, onChange);
  const items = checklist(config);
  const root = useRef<HTMLDivElement>(null);
  // Opens on the document the screen has in focus, when it is on the checklist.
  const [active, setActive] = useState<DocumentItem | null>(() => focusedItem(items, focus));
  // The capture screen shows a kept file by name; the editor's preview has none to show.
  const showsFiles = useFileSlotRenderer() !== null;
  // An issue link lands on the field, or on a missing file's message, which takes the focus itself.
  useIssueFocus(focusPath, { root });

  const focusItem = (key: DocumentItem) => {
    setActive(key);
    onFocusChange?.({ item: key });
  };
  // Empty when the module could not be evaluated (invalid data or config), whatever its type says.
  const computed: Partial<DocumentsComputed> | undefined = evaluation?.computed;

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground touch:text-base">No documents are switched on for this template.</p>;
  }

  // Steri-AI links files to rows; until one is linked, the line under the list says what it found.
  const anyFile = items.some((item) => data.items[item.key].file !== null);

  return (
    // @container: the checklist lays out by the module's own width, not the screen's.
    <div ref={root} className="@container space-y-4">
      {/* From 1280 px, in a module at least 48rem wide (@3xl), each item is one row of four
          columns, about 47rem with the default wording: the capture screen's section list
          leaves narrower modules (at 1280 and 1366 px) the stacked rows the iPad has. A
          template's longer status words scroll the table rather than hide a column. */}
      <div className="overflow-clip rounded-lg border border-border bg-card xl:@3xl:grid xl:@3xl:grid-cols-[minmax(11rem,1fr)_auto_minmax(9rem,12rem)_10.5rem] xl:@3xl:gap-x-3 xl:@3xl:overflow-x-auto">
        {/* One row per item: the columns get headings (each control has its own name). */}
        <div
          aria-hidden
          className="hidden border-b border-border px-4 py-2 text-sm font-medium text-muted-foreground xl:@3xl:col-span-full xl:@3xl:grid xl:@3xl:grid-cols-subgrid"
        >
          <span>{title}</span>
          <span>{labelFor(labels, "status")}</span>
          <span>{labelFor(labels, "referenceNo")}</span>
          <span>{labelFor(labels, "expiryDate")}</span>
        </div>
        <ul className="divide-y divide-border xl:@3xl:col-span-full xl:@3xl:grid xl:@3xl:grid-cols-subgrid">
          {items.map((item) => {
            const entry = data.items[item.key];
            // calc's state of the row's file, but none as soon as it is unlinked: calc runs a render behind
            // the data, and meanwhile the line would say "Attached" and could take Unlink's focus, then go.
            const fileState = entry.file === null ? "none" : (computed?.fileState?.[item.key] ?? heldFileState(context, entry.file));
            return (
              <DocumentRow
                key={item.key}
                item={item}
                entry={entry}
                status={computed?.itemStatus?.[item.key] ?? "not_done"}
                expired={computed?.expired?.[item.key] ?? null}
                fileState={fileState}
                fileSlot={
                  showsFiles && entry.file !== null ? (
                    <ModuleFileSlot
                      moduleKey="documents"
                      kind={DOCUMENT_FILE_KIND[item.key]}
                      fileId={entry.file}
                      state={fileState}
                      readOnly={readOnly}
                      // Unlink lets this row go of the file; the file stays on Source Documents.
                      onRemoved={(fileId) =>
                        update((current) =>
                          current.items[item.key].file === fileId ? withItemValues(current, item.key, { file: null }) : current,
                        )
                      }
                    />
                  ) : undefined
                }
                labels={labels}
                issues={evaluation?.issues}
                active={active === item.key}
                readOnly={readOnly}
                onFocusItem={() => focusItem(item.key)}
                onUpdate={(values) => update((current) => withItemValues(current, item.key, values))}
              />
            );
          })}
        </ul>
      </div>
      {!anyFile && (
        <ModuleFileSlot
          moduleKey="documents"
          kind="certificate"
          fileId={null}
          state="none"
          notFoundText="No documents detected by Steri-AI."
          readOnly={readOnly}
          onRemoved={() => {}}
          className="text-sm touch:text-base"
        />
      )}
    </div>
  );
}

/**
 * One item of the checklist. Its markup never depends on `active` apart from
 * `data-active`: a row becomes active on pointerdown, and a row above that
 * grew or shrank mid-press would move the control under the finger, so the
 * tap would land elsewhere. Exported for that test.
 */
export function DocumentRow({
  item,
  entry,
  status,
  expired,
  fileState = "none",
  fileSlot,
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
  /** The item's file: none kept, attached, or deleted since. */
  fileState?: HeldFileState;
  /** The screen's file slot for the kept file (its name, Preview and Unlink), in place of the line's own words. */
  fileSlot?: ReactNode;
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
  const expiryIssue = findIssue(fieldIssues(issues), path("expiryDate"));
  const fileIssue = findIssue(fieldIssues(issues), path("file"));
  const tone = entry.status !== null && speaksOf(status, entry.status) ? SELECTED_TONE[status] : undefined;
  const fileLineId = `${uid}-file`;

  return (
    <li
      data-active={active || undefined}
      className="space-y-3 px-4 py-3 data-active:bg-accent xl:@3xl:col-span-full xl:@3xl:grid xl:@3xl:grid-cols-subgrid xl:@3xl:items-start xl:@3xl:gap-y-2 xl:@3xl:space-y-0 xl:@3xl:py-2.5"
      onFocus={onFocusItem}
      onPointerDown={onFocusItem}
      {...issuePathProps(["items", item.key])}
    >
      <div className="flex items-start justify-between gap-3 xl:@3xl:flex-col xl:@3xl:justify-start xl:@3xl:gap-1">
        <div className="min-w-0 flex-1 space-y-1 xl:@3xl:w-full xl:@3xl:flex-none">
          <p id={`${uid}-name`} className="font-semibold text-foreground touch:text-base">
            {name}
          </p>
          {item.required && (
            <Badge variant="secondary" className="touch:h-8 touch:px-3 touch:text-base">
              {labelFor(labels, "required")}
            </Badge>
          )}
          {fileState !== "none" && (
            // The kit's line for the file the row keeps, with calc's warning when it is missing. It
            // takes an issue link's focus itself, and the row's status is described by it.
            <div id={fileLineId} data-file-state={fileState} className="pt-1">
              <AttachmentStatus
                label={labelFor(labels, "file")}
                state={fileState}
                warning={fileIssue?.message ?? null}
                issuePath={path("file")}
              >
                {fileSlot}
              </AttachmentStatus>
            </div>
          )}
        </div>
        <StatusPill size="sm" status={status} label={chipLabel(status, entry.status, labels)} />
      </div>

      <div className="space-y-1.5" {...issuePathProps(path("status"))}>
        <span id={`${uid}-status`} className="text-sm font-medium touch:text-base xl:@3xl:sr-only">
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
            aria-describedby={fileState === "missing" ? fileLineId : undefined}
            className="w-full flex-wrap xl:@3xl:w-auto xl:@3xl:flex-nowrap"
          >
            {DOCUMENT_STATUSES.map((value) => (
              <ToggleGroupItem
                key={value}
                value={value}
                className={cn(
                  "flex-1 rounded-full px-3 data-[state=on]:font-semibold touch:text-base xl:@3xl:flex-none",
                  value === entry.status && tone,
                )}
              >
                {labelFor(labels, "status", value)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:@3xl:contents">
        <div className="space-y-1.5" {...issuePathProps(path("referenceNo"))}>
          {/* leading-snug, as DateField's label beside it, so the two fields line up. */}
          <Label htmlFor={`${uid}-reference`} className="leading-snug touch:text-base xl:@3xl:sr-only">
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
        <DateField
          id={`${uid}-expiry`}
          // The column's heading names it in the one-row layout; the label stays for screen readers.
          label={<span className="xl:@3xl:sr-only">{labelFor(labels, "expiryDate")}</span>}
          className="xl:@3xl:[&>label]:mb-0"
          aria-label={`${labelFor(labels, "expiryDate")}, ${name}`}
          value={entry.expiryDate}
          onValueChange={(expiryDate) => onUpdate({ expiryDate })}
          error={expiryIssue?.level === "error" ? expiryIssue.message : null}
          warning={expiryIssue?.level === "warning" ? expiryIssue.message : null}
          // Expired with calc's message not in yet: the amber edge alone.
          inputClassName={cn(expired === true && expiryIssue === undefined && "border-warn-solid")}
          issuePath={path("expiryDate")}
          readOnly={readOnly}
        />
      </div>
    </li>
  );
}

/** The document the screen has in focus (CaptureProps.focus), when it is on the checklist. */
function focusedItem(items: readonly DocumentItemConfig[], focus: CaptureFocus | null | undefined): DocumentItem | null {
  return items.find((item) => item.key === focus?.item)?.key ?? null;
}

/**
 * Whether calc's result for the item is about the status on screen; calc may
 * still be a tap behind. A pass is a verified item; a fail or info one not
 * verified or NA; an expired warning one that is not NA.
 */
function speaksOf(status: Status, selected: DocumentStatus): boolean {
  if (status === "pass") return selected === "verified";
  if (status === "fail" || status === "info") return selected !== "verified";
  if (status === "warn") return selected !== "na";
  return false;
}

/**
 * The chip's words for calc's result: the item's status in the template's
 * wording, "Expired" for a warning. While calc catches up with a tap, a word
 * that does not fit its verdict gives way to the verdict's own word.
 */
function chipLabel(status: Status, selected: DocumentStatus | null, labels: Labels): string | undefined {
  if (selected === null || !speaksOf(status, selected)) return undefined;
  return status === "warn" ? labelFor(labels, "expired") : labelFor(labels, "status", selected);
}
