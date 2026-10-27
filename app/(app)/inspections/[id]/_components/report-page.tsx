"use client";

// The capture screen's Report page (Kenneth, 27 October 2026: "After
// conclusion page, give another page "Report", thats the page where report
// generation is done, inclusing customizing report"): after the Conclusion,
// before the Audit Log, never a step. The report's options on the left,
// about 22rem, saved with the inspection through the autosave like any field
// (lib/inspections/capture/report.ts), and the report itself on the right,
// which stays in view while the options scroll (PANES). Stacked, options
// first, on a narrower touchscreen (an iPad in portrait).
//
// The options follow the report's design (Kenneth: "make the setting of
// report match the the report design"): General, then the report's content
// as a tree, the Summary (always in) and a row per section with its switch,
// each opening to its blocks' switches, a section the inspection cannot
// show greyed with why, then the photo records. The preview is the report's
// own pages in the new design (components/report), built from this
// screen's copy of the inspection as it stands (lib/report/live-export.ts),
// so they follow every option and entry at once. Download PDF opens the
// print route in a new tab, what is waiting saved first, and the browser's
// print dialog saves the PDF there. Steri-AI describes, in the background,
// the photos the report can show that it has not looked at, in one line
// under Download PDF (docs/AI.md, "Describing photos"). Read-only, the
// options show as saved.
import { ChevronRightIcon, DownloadIcon } from "lucide-react";
import { useId, useMemo, useState, type MouseEvent, type ReactNode, type Ref } from "react";
import { useBackgroundDescriptions, useInspectionMedia } from "@/components/capture/photos";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PillSwitch, type PillOption } from "@/components/ui/pill-switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { NOT_IN_INSPECTION, reportSectionsAvailable } from "@/lib/inspections/capture/report";
import { REPORT_KEY, REPORT_TITLE } from "@/lib/inspections/capture/sections";
import type { MediaPhoto } from "@/lib/inspections/photos/view";
import { liveReportExport, type LiveExportInput, type LivePhoto } from "@/lib/report/live-export";
import { buildReportModel, sectionTitle, type ReportModel } from "@/lib/report/model";
import { reportPrintPath } from "@/lib/report/paths";
import type { ModuleKey } from "@/lib/schemas/module-result";
import {
  DEFAULT_REPORT_TITLE,
  REPORT_FIELDS,
  REPORT_LIMITS,
  REPORT_PAGE_SIZES,
  REPORT_PHOTO_GROUPS,
  REPORT_PHOTOS_PER_GROUP,
  REPORT_SECTIONS,
  REPORT_SUMMARY,
  REPORT_TEMPLATES,
  type ReportOptions,
  type ReportPageSize,
  type ReportPhotosPerGroup,
  type ReportSectionKey,
} from "@/lib/schemas/report-options";
import { cn } from "@/lib/utils";
import { PhotoDescribeStatus } from "./photo-describe-status";
import { ReportPagesPreview } from "./report-pages-preview";
import { SectionFrame } from "./section-frame";

/** Under the pages: what Download PDF does with them. */
export const PREVIEW_CAPTION = "Download PDF opens these pages in a new tab: choose Save as PDF in the print dialog.";

/**
 * Why Download PDF waits: the role's Export Reports is off. The export's rule
 * lets everyone who can open an inspection download it (its inspector, their
 * lead inspector, admins).
 */
export const DOWNLOAD_NOT_ALLOWED = "Your role does not allow exporting reports.";

/**
 * The options and the preview side by side: on a desktop (`xl`, from 1280 px
 * with no touchscreen, where the app's sidebar and the screen's leave the
 * page about 41rem) and wherever the page is 56rem wide (an iPad in
 * landscape). PREVIEW_BESIDE keeps the preview in view in the same two cases.
 */
const PANES = "xl:grid-cols-[22rem_minmax(0,1fr)] @min-[56rem]:grid-cols-[22rem_minmax(0,1fr)]";
const PREVIEW_BESIDE = cn(
  "xl:sticky xl:top-[calc(var(--capture-sticky-top)_+_1rem)] xl:max-h-[calc(100dvh_-_var(--capture-sticky-top)_-_2rem)]",
  "@min-[56rem]:sticky @min-[56rem]:top-[calc(var(--capture-sticky-top)_+_1rem)] @min-[56rem]:max-h-[calc(100dvh_-_var(--capture-sticky-top)_-_2rem)]",
);

/** What the preview is built from: the screen's copy of the inspection, all but the photos (the page reads those). */
export type ReportSource = Omit<LiveExportInput, "photos">;

/** Download PDF: whether this user may print the report (the export's rule), and how to save what is waiting first. */
export type ReportDownload = { allowed: boolean; saveFirst: () => Promise<unknown> };

type ReportPageProps = {
  /** The panel id the section tabs point at. */
  id: string;
  /** Below 1280 px: the id of the page's tab, which names the panel. */
  tabLabelledBy?: string;
  titleRef: (key: string) => Ref<HTMLHeadingElement>;
  inspectionId: string;
  options: ReportOptions;
  source: ReportSource;
  readOnly: boolean;
  download: ReportDownload;
  /** The options with one changed: saved with the inspection's data. */
  onChange: (options: ReportOptions) => void;
};

export function ReportPage({
  id,
  tabLabelledBy,
  titleRef,
  inspectionId,
  options,
  source,
  readOnly,
  download,
  onChange,
}: ReportPageProps) {
  // The photos this page knows (the screen's media store): what the photo records choose from.
  const media = useInspectionMedia(inspectionId);
  const photos = useMemo(() => livePhotos(media.media?.photos ?? []), [media.media]);
  const model = useMemo(() => {
    const doc = liveReportExport({ ...source, photos });
    return doc ? buildReportModel(doc) : null;
  }, [source, photos]);
  const moduleKeys = useMemo(() => source.evaluation.report.modules.map((evaluation) => evaluation.key), [source.evaluation]);
  // Steri-AI describes the photos the report can show that it has not looked at yet; the preview follows.
  const describing = useBackgroundDescriptions(inspectionId);
  return (
    <div
      id={id}
      role={tabLabelledBy ? "tabpanel" : undefined}
      aria-labelledby={tabLabelledBy}
      data-slot="report-page"
      data-section-key={REPORT_KEY}
      // The desktop layout, else the page's own width, decides the panes (PANES).
      className="@container"
    >
      <div className={cn("grid items-start gap-4", PANES)}>
        <ReportOptionsCard
          id={`${id}-options`}
          headingRef={titleRef(REPORT_KEY)}
          options={options}
          moduleKeys={moduleKeys}
          readOnly={readOnly}
          onChange={onChange}
        />
        <ReportPreviewCard
          id={`${id}-preview`}
          inspectionId={inspectionId}
          model={model}
          pageSize={options.pageSize}
          download={download}
          status={<PhotoDescribeStatus state={describing.state} retry={describing.retry} />}
        />
      </div>
    </div>
  );
}

/** The media store's photos as the live export takes them, each with the best link the browser has. */
export function livePhotos(photos: readonly MediaPhoto[]): LivePhoto[] {
  return photos.map((photo) => ({
    id: photo.id,
    moduleKey: photo.moduleKey,
    target: photo.target,
    caption: photo.caption,
    takenAt: photo.takenAt,
    includeInReport: photo.includeInReport,
    flagged: photo.flagged,
    storagePath: photo.storagePath,
    createdAt: photo.createdAt,
    description: photo.description,
    url: photo.fullUrl ?? photo.thumbUrl,
  }));
}

/* ------------------------------------------------------------------ *
 * The options
 * ------------------------------------------------------------------ */

/** The option groups' titles: the H4 group style, 16 px (FieldLegend's size; docs/DESIGN.md, Type scale). */
const LEGEND = "mb-2 font-display font-semibold text-foreground";

/** A row of the content tree or the photo records: 36 px, 44 px on any touchscreen. */
const ROW = "flex min-h-9 items-center gap-2 py-1 pr-4 touch:min-h-11";

const PAGE_SIZE_OPTIONS: readonly PillOption<ReportPageSize>[] = REPORT_PAGE_SIZES.map(({ value, label }) => ({ value, label }));
const PER_GROUP_OPTIONS: readonly PillOption<`${ReportPhotosPerGroup}`>[] = REPORT_PHOTOS_PER_GROUP.map((count) => ({
  value: `${count}`,
  label: `${count}`,
}));

export function ReportOptionsCard({
  id,
  headingRef,
  options,
  moduleKeys,
  readOnly,
  onChange,
}: {
  id: string;
  headingRef: Ref<HTMLHeadingElement>;
  options: ReportOptions;
  /** The modules the inspection includes: a section of none of them is not offered. */
  moduleKeys: readonly ModuleKey[];
  readOnly: boolean;
  onChange: (options: ReportOptions) => void;
}) {
  const update = (patch: Partial<ReportOptions>) => onChange({ ...options, ...patch });
  const template = REPORT_TEMPLATES.find((choice) => choice.value === options.template) ?? REPORT_TEMPLATES[0];
  const available = useMemo(() => reportSectionsAvailable(moduleKeys), [moduleKeys]);
  // Every section starts closed; which are open is this visit's own.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const anyGroup = REPORT_PHOTO_GROUPS.some((group) => options.photos.groups[group.key]);

  const setSummaryBlock = (key: string, on: boolean) => update({ summary: { ...options.summary, [key]: on } });
  const setSection = (key: ReportSectionKey, patch: { include?: boolean; block?: [string, boolean] }) => {
    const section = options.sections[key];
    const blocks = patch.block ? { ...section.blocks, [patch.block[0]]: patch.block[1] } : section.blocks;
    update({ sections: { ...options.sections, [key]: { include: patch.include ?? section.include, blocks } } });
  };

  return (
    <SectionFrame
      id={id}
      title={REPORT_TITLE}
      headingRef={headingRef}
      summary={readOnly ? "The options saved with this inspection." : "Choose what the report shows. Saved with this inspection."}
    >
      <div data-slot="report-options" className="grid gap-6">
        <FieldSet className="gap-3">
          <FieldLegend className={LEGEND}>{REPORT_FIELDS.general.label}</FieldLegend>
          <Field>
            <FieldLabel htmlFor={`${id}-template`} className="touch:text-base">
              {REPORT_FIELDS.template.label}
            </FieldLabel>
            <Select
              value={options.template}
              onValueChange={(next) => {
                const choice = REPORT_TEMPLATES.find((entry) => entry.value === next);
                if (choice) update({ template: choice.value });
              }}
              disabled={readOnly}
            >
              <SelectTrigger id={`${id}-template`} className="w-full">
                <SelectValue>{template.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {REPORT_TEMPLATES.map((choice) => (
                  <SelectItem key={choice.value} value={choice.value}>
                    {choice.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <ChoiceRow
            label={REPORT_FIELDS.pageSize.label}
            value={options.pageSize}
            options={PAGE_SIZE_OPTIONS}
            onChange={(pageSize) => update({ pageSize })}
            disabled={readOnly}
          />
          <Field>
            {/* Not `${id}-title`: the card's heading has that id (SectionFrame). */}
            <FieldLabel htmlFor={`${id}-report-title`} className="touch:text-base">
              {REPORT_FIELDS.title.label}
            </FieldLabel>
            <Input
              id={`${id}-report-title`}
              value={options.title}
              onChange={(event) => update({ title: event.target.value })}
              maxLength={REPORT_LIMITS.title}
              // Blank, the report takes the default title.
              placeholder={DEFAULT_REPORT_TITLE}
              autoComplete="off"
              readOnly={readOnly}
            />
          </Field>
          <SwitchRow
            id={`${id}-client`}
            label={REPORT_FIELDS.showClient.label}
            checked={options.showClient}
            onChange={(showClient) => update({ showClient })}
            disabled={readOnly}
          />
          <Field>
            <FieldLabel htmlFor={`${id}-footer`} className="touch:text-base">
              {REPORT_FIELDS.footerNote.label}
            </FieldLabel>
            <Textarea
              id={`${id}-footer`}
              value={options.footerNote}
              onChange={(event) => update({ footerNote: event.target.value })}
              maxLength={REPORT_LIMITS.footerNote}
              rows={2}
              readOnly={readOnly}
              aria-describedby={`${id}-footer-count`}
            />
            <p id={`${id}-footer-count`} className="-mt-1 text-right text-xs text-muted-foreground tabular-nums touch:text-sm">
              {options.footerNote.length} / {REPORT_LIMITS.footerNote}
            </p>
          </Field>
        </FieldSet>

        <FieldSet className="gap-0">
          <FieldLegend className={LEGEND}>{REPORT_FIELDS.content.label}</FieldLegend>
          <ul data-slot="report-content" className="divide-y divide-border rounded-lg ring-1 ring-border">
            <TreeRow
              id={id}
              rowKey="summary"
              title={REPORT_SUMMARY.title}
              note="Always included"
              open={open.has("summary")}
              onToggle={() => toggle("summary")}
              blocks={REPORT_SUMMARY.blocks.map((block) => ({
                key: block.key,
                label: block.label,
                checked: options.summary[block.key],
                onChange: (on: boolean) => setSummaryBlock(block.key, on),
              }))}
              blocksDisabled={readOnly}
            />
            {REPORT_SECTIONS.map((section) => {
              const inInspection = available[section.key];
              const saved = options.sections[section.key];
              const switches = saved.blocks as Record<string, boolean>;
              return (
                <TreeRow
                  key={section.key}
                  id={id}
                  rowKey={section.key}
                  title={sectionTitle(section.key, section.modules.filter((key) => moduleKeys.includes(key)))}
                  // A section the inspection cannot show is greyed, off, with why; it stays out of the report.
                  note={inInspection ? null : NOT_IN_INSPECTION}
                  unavailable={!inInspection}
                  toggle={{
                    checked: inInspection && saved.include,
                    onChange: (include: boolean) => setSection(section.key, { include }),
                    disabled: readOnly || !inInspection,
                  }}
                  open={inInspection && open.has(section.key)}
                  onToggle={inInspection ? () => toggle(section.key) : undefined}
                  blocks={section.blocks.map((block) => ({
                    key: block.key,
                    label: block.label,
                    checked: switches[block.key] ?? true,
                    onChange: (on: boolean) => setSection(section.key, { block: [block.key, on] }),
                  }))}
                  blocksDisabled={readOnly || !inInspection || !saved.include}
                />
              );
            })}
          </ul>
        </FieldSet>

        <FieldSet className="gap-1">
          <FieldLegend className={LEGEND}>{REPORT_FIELDS.photos.label}</FieldLegend>
          <ul data-slot="report-photo-records" className="divide-y divide-border rounded-lg ring-1 ring-border">
            {REPORT_PHOTO_GROUPS.map((group, index) => (
              <li key={group.key} data-group={group.key} className={cn(ROW, "pl-3")}>
                <Label htmlFor={`${id}-photos-${group.key}`} className="min-w-0 flex-1 leading-snug touch:text-base">
                  <span className="text-muted-foreground tabular-nums">{index + 1}</span>
                  {group.title}
                </Label>
                <Switch
                  id={`${id}-photos-${group.key}`}
                  checked={options.photos.groups[group.key]}
                  onCheckedChange={(on) => update({ photos: { ...options.photos, groups: { ...options.photos.groups, [group.key]: on } } })}
                  disabled={readOnly}
                />
              </li>
            ))}
          </ul>
          <ChoiceRow
            label={REPORT_FIELDS.perGroup.label}
            value={`${options.photos.perGroup}`}
            options={PER_GROUP_OPTIONS}
            onChange={(count) => update({ photos: { ...options.photos, perGroup: Number(count) as ReportPhotosPerGroup } })}
            disabled={readOnly || !anyGroup}
            className="mt-2"
          />
        </FieldSet>
      </div>
    </SectionFrame>
  );
}

type BlockSwitch = { key: string; label: string; checked: boolean; onChange: (on: boolean) => void };

/**
 * A row of the content tree: a chevron that opens the row's blocks (closed
 * at first), the section's name with a note under it (why it is greyed),
 * and its switch, or the Summary's note that it is always in. The blocks'
 * switches sit under it, indented, each a row of its own.
 */
function TreeRow({
  id,
  rowKey,
  title,
  note,
  unavailable = false,
  toggle,
  open,
  onToggle,
  blocks,
  blocksDisabled,
}: {
  id: string;
  rowKey: string;
  title: string;
  note: string | null;
  /** A section the inspection cannot show. */
  unavailable?: boolean;
  /** The row's own switch; the Summary has none. */
  toggle?: { checked: boolean; onChange: (on: boolean) => void; disabled: boolean };
  open: boolean;
  /** Left out where the row cannot open (a section not in this inspection). */
  onToggle?: () => void;
  blocks: readonly BlockSwitch[];
  blocksDisabled: boolean;
}) {
  const switchId = `${id}-section-${rowKey}`;
  const partsId = `${id}-parts-${rowKey}`;
  const opens = blocks.length > 0 && onToggle !== undefined;
  return (
    <li data-section={rowKey} data-available={unavailable ? "false" : undefined}>
      <div className={cn(ROW, "pl-1")}>
        {opens ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={partsId}
            onClick={onToggle}
            className="relative inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-ring-inset touch:size-11"
          >
            <ChevronRightIcon aria-hidden className={cn("size-4 transition-transform touch:size-5", open && "rotate-90")} />
            <span className="sr-only">Parts of {title}</span>
          </button>
        ) : (
          <span aria-hidden className="size-7 shrink-0 touch:size-11" />
        )}
        <div className="min-w-0 flex-1">
          {toggle ? (
            <Label htmlFor={switchId} className="leading-snug [overflow-wrap:anywhere] touch:text-base">
              {title}
            </Label>
          ) : (
            <p className="text-sm leading-snug font-medium text-foreground touch:text-base">{title}</p>
          )}
          {note && <p className="text-xs text-muted-foreground touch:text-sm">{note}</p>}
        </div>
        {toggle && <Switch id={switchId} checked={toggle.checked} onCheckedChange={toggle.onChange} disabled={toggle.disabled} />}
      </div>
      {opens && (
        <ul id={partsId} hidden={!open} data-slot="report-blocks" className="divide-y divide-border border-t border-border bg-muted/40">
          {blocks.map((block) => (
            <li key={block.key} data-block={block.key} className={cn(ROW, "pl-10 touch:pl-14")}>
              <Label htmlFor={`${switchId}-${block.key}`} className="min-w-0 flex-1 leading-snug font-normal touch:text-base">
                {block.label}
              </Label>
              <Switch id={`${switchId}-${block.key}`} checked={block.checked} onCheckedChange={block.onChange} disabled={blocksDisabled} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** A switch at the end of its label's row: 36 px rows, 44 px on any touchscreen. */
function SwitchRow({
  id,
  label,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex min-h-9 items-center gap-3 pr-1 touch:min-h-11">
      <Label htmlFor={id} className="min-w-0 flex-1 leading-snug touch:text-base">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

/** A choice of a few at the end of its label's row, wrapping under it where the card is narrow. */
function ChoiceRow<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  label: string;
  value: T;
  options: readonly PillOption<T>[];
  onChange: (value: T) => void;
  disabled: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 touch:min-h-11", className)}>
      {/* The pills are named by the same words (PillSwitch's label): read out once. */}
      <span aria-hidden className="text-sm leading-snug font-medium text-foreground touch:text-base">
        {label}
      </span>
      <PillSwitch value={value} options={options} onValueChange={onChange} label={label} disabled={disabled} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The preview, with Download PDF
 * ------------------------------------------------------------------ */

export function ReportPreviewCard({
  id,
  inspectionId,
  model,
  pageSize,
  download,
  status,
}: {
  id: string;
  inspectionId: string;
  /** Null when the screen's copy does not make a report (the page says so). */
  model: ReportModel | null;
  pageSize: ReportPageSize;
  download: ReportDownload;
  /** One line under the actions: Steri-AI describing the report's photos. */
  status?: ReactNode;
}) {
  const titleId = `${id}-title`;
  const paper = REPORT_PAGE_SIZES.find((size) => size.value === pageSize)?.label ?? pageSize;
  const count = model?.pageCount ?? 0;
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      data-slot="report-preview"
      // Beside the options, it stays in view while they scroll, its pages scrolling inside it.
      className={cn("flex min-w-0 flex-col rounded-xl bg-card text-card-foreground shadow-sm ring-1 ring-border", PREVIEW_BESIDE)}
    >
      <header className="space-y-3 border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id={titleId} className="text-lg leading-snug font-bold text-foreground">
            Preview
          </h2>
          {model && (
            <p data-slot="report-page-count" className="text-sm text-muted-foreground tabular-nums touch:text-base">
              {count === 1 ? "1 page" : `${count} pages`} · {paper}
            </p>
          )}
        </div>
        <ReportActions inspectionId={inspectionId} download={download} />
        {status}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto bg-slate-100 p-4">
        {model ? (
          <ReportPagesPreview model={model} />
        ) : (
          <p role="status" className="rounded-lg bg-card px-4 py-6 text-center text-sm text-muted-foreground ring-1 ring-border touch:text-base">
            The preview could not be made from this inspection as it stands. Download PDF makes the report from what is saved.
          </p>
        )}
      </div>
      <p className="rounded-b-xl border-t border-border px-5 py-3 text-sm text-muted-foreground touch:text-base">{PREVIEW_CAPTION}</p>
    </section>
  );
}

/**
 * Download PDF, the primary action: the print route in a new tab, where
 * the browser's print dialog saves the PDF. A plain click opens the tab at
 * once (so no pop-up blocker stops it) and sends it on once what is waiting
 * is saved, so the PDF has the latest options; a click with a modifier, or
 * a middle click, opens the link as the browser does.
 */
export function ReportActions({ inspectionId, download }: { inspectionId: string; download: ReportDownload }) {
  const reasonId = useId();
  const href = reportPrintPath(inspectionId, { autoPrint: true });
  const { saveFirst } = download;
  const onDownload = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const tab = window.open("", "_blank");
    void saveFirst()
      .catch(() => undefined)
      .finally(() => {
        if (tab) {
          tab.opener = null;
          tab.location.href = href;
        } else {
          window.location.assign(href);
        }
      });
  };
  return (
    <div className="grid max-w-full gap-1.5">
      {download.allowed ? (
        <Button asChild className="relative w-fit">
          <a href={href} target="_blank" rel="noopener" onClick={onDownload} data-slot="report-download">
            <DownloadIcon aria-hidden />
            Download PDF
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </Button>
      ) : (
        <>
          <Button type="button" disabled aria-describedby={reasonId} className="w-fit" data-slot="report-download">
            <DownloadIcon aria-hidden />
            Download PDF
          </Button>
          <p id={reasonId} className="text-sm text-muted-foreground touch:text-base">
            {DOWNLOAD_NOT_ALLOWED}
          </p>
        </>
      )}
    </div>
  );
}
