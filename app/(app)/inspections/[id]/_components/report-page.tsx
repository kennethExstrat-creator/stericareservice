"use client";

// The capture screen's Report page (Kenneth, 27 October 2026: "After
// conclusion page, give another page "Report", thats the page where report
// generation is done, inclusing customizing report"): after the Conclusion,
// before the Audit Log, never a step. The report's options on the left,
// about 22rem, saved with the inspection through the autosave like any field
// (lib/inspections/capture/report.ts), and a layout preview on the right
// with Generate Report at its top, which stays in view while the options
// scroll (PANES). Stacked, options first, on a narrower touchscreen (an iPad
// in portrait). The preview draws the pages from the options as they change
// (report-preview.ts): the report's design comes later (Kenneth: "for the
// report template design, i will give u later, build the visual framework
// first"), and this app never renders a report. Generate Report sends the
// export, the options in it, to the report service, as the review's Send to
// Steri-AI Report does (BUILD_SPEC 9.1), with the same rules; otherwise it
// waits and says why. Read-only, the options show as saved.
import { ExternalLinkIcon, FileTextIcon, ImageIcon } from "lucide-react";
import { useActionState, useEffect, useId, useMemo, useRef, type CSSProperties, type Ref } from "react";
import { toast } from "sonner";
import { focusIfLost } from "@/components/ai/focus-handoff";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PillSwitch, type PillOption } from "@/components/ui/pill-switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { sendToAiReport } from "@/lib/inspections/ai/actions";
import { AI_ACTION_IDLE, type AiActionState } from "@/lib/inspections/ai/types";
import {
  stepInReport,
  withStepInReport,
  type GenerateAvailability,
  type LastReport,
  type ReportStep,
} from "@/lib/inspections/capture/report";
import { reportPreview, type PlacedBlock, type PreviewPage, type ReportPreview } from "@/lib/inspections/capture/report-preview";
import { REPORT_KEY, REPORT_TITLE } from "@/lib/inspections/capture/sections";
import {
  DEFAULT_REPORT_TITLE,
  REPORT_FIELDS,
  REPORT_LIMITS,
  REPORT_PAGE_SIZES,
  REPORT_PHOTO_SIZES,
  REPORT_PHOTOS_PER_STEP,
  REPORT_TEMPLATES,
  type ReportOptions,
  type ReportPageSize,
  type ReportPhotoSize,
} from "@/lib/schemas/report-options";
import { cn } from "@/lib/utils";
import { SectionFrame } from "./section-frame";
import { unreachable } from "./unreachable";

/** Under the preview: what it is, and what is still to come. */
export const PREVIEW_CAPTION = "Layout preview. The report design will follow.";

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

/** What the preview names: the inspection's own reference, client and inspector. */
export type ReportFacts = { refNo: string; clientName: string | null; inspectorName: string };

type ReportPageProps = {
  /** The panel id the section tabs point at. */
  id: string;
  /** Below 1280 px: the id of the page's tab, which names the panel. */
  tabLabelledBy?: string;
  titleRef: (key: string) => Ref<HTMLHeadingElement>;
  inspectionId: string;
  options: ReportOptions;
  /** The inspection's steps, in step order (reportSteps): a switch each. */
  steps: readonly ReportStep[];
  facts: ReportFacts;
  readOnly: boolean;
  generate: GenerateAvailability;
  lastReport: LastReport | null;
  /** The options with one changed: saved with the inspection's data. */
  onChange: (options: ReportOptions) => void;
};

export function ReportPage({
  id,
  tabLabelledBy,
  titleRef,
  inspectionId,
  options,
  steps,
  facts,
  readOnly,
  generate,
  lastReport,
  onChange,
}: ReportPageProps) {
  const { refNo, clientName, inspectorName } = facts;
  const preview = useMemo(
    () => reportPreview({ options, steps, refNo, clientName, inspectorName }),
    [options, steps, refNo, clientName, inspectorName],
  );
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
          steps={steps}
          readOnly={readOnly}
          onChange={onChange}
        />
        <ReportPreviewCard
          id={`${id}-preview`}
          inspectionId={inspectionId}
          preview={preview}
          generate={generate}
          lastReport={lastReport}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The options
 * ------------------------------------------------------------------ */

/** The option groups' titles: the H4 group style, 16 px (FieldLegend's size; docs/DESIGN.md, Type scale). */
const LEGEND = "mb-2 font-display font-semibold text-foreground";

const PAGE_SIZE_OPTIONS: readonly PillOption<ReportPageSize>[] = REPORT_PAGE_SIZES.map(({ value, label }) => ({ value, label }));
const PHOTO_SIZE_OPTIONS: readonly PillOption<ReportPhotoSize>[] = REPORT_PHOTO_SIZES.map(({ value, label }) => ({ value, label }));
const PER_STEP_OPTIONS: readonly PillOption<`${(typeof REPORT_PHOTOS_PER_STEP)[number]}`>[] = REPORT_PHOTOS_PER_STEP.map(
  (count) => ({ value: `${count}`, label: `${count}` }),
);

export function ReportOptionsCard({
  id,
  headingRef,
  options,
  steps,
  readOnly,
  onChange,
}: {
  id: string;
  headingRef: Ref<HTMLHeadingElement>;
  options: ReportOptions;
  steps: readonly ReportStep[];
  readOnly: boolean;
  onChange: (options: ReportOptions) => void;
}) {
  const update = (patch: Partial<ReportOptions>) => onChange({ ...options, ...patch });
  const template = REPORT_TEMPLATES.find((choice) => choice.value === options.template) ?? REPORT_TEMPLATES[0];
  const photosOff = readOnly || !options.includePhotos;
  return (
    <SectionFrame
      id={id}
      title={REPORT_TITLE}
      headingRef={headingRef}
      summary={readOnly ? "The options saved with this inspection." : "Choose what the report shows. Saved with this inspection."}
    >
      <div data-slot="report-options" className="grid gap-6">
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
            <SelectTrigger id={`${id}-template`} className="w-full" aria-describedby={`${id}-template-hint`}>
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
          <FieldDescription id={`${id}-template-hint`} className="touch:text-base">
            {REPORT_FIELDS.template.hint}
          </FieldDescription>
        </Field>

        <ChoiceRow
          label={REPORT_FIELDS.pageSize.label}
          value={options.pageSize}
          options={PAGE_SIZE_OPTIONS}
          onChange={(pageSize) => update({ pageSize })}
          disabled={readOnly}
        />

        <FieldSet className="gap-0">
          <FieldLegend className={LEGEND}>{REPORT_FIELDS.sections.label}</FieldLegend>
          <ul data-slot="report-sections" className="divide-y divide-border rounded-lg ring-1 ring-border">
            {steps.map((step) => (
              <li key={step.key} data-step={step.key} className="flex min-h-9 items-center gap-3 py-1 pr-4 pl-3 touch:min-h-11">
                <Label
                  htmlFor={`${id}-step-${step.key}`}
                  // The step's full title on hover (docs/DESIGN.md, Step Names).
                  title={step.title}
                  className="min-w-0 flex-1 leading-snug [overflow-wrap:anywhere] touch:text-base"
                >
                  {step.shortTitle}
                </Label>
                <Switch
                  id={`${id}-step-${step.key}`}
                  checked={stepInReport(options, step.key)}
                  onCheckedChange={(on) => onChange(withStepInReport(options, step.key, on))}
                  disabled={readOnly}
                />
              </li>
            ))}
          </ul>
        </FieldSet>

        <FieldSet className="gap-1">
          <FieldLegend className={LEGEND}>{REPORT_FIELDS.photos.label}</FieldLegend>
          <SwitchRow
            id={`${id}-photos`}
            label={REPORT_FIELDS.includePhotos.label}
            checked={options.includePhotos}
            onChange={(includePhotos) => update({ includePhotos })}
            disabled={readOnly}
          />
          <ChoiceRow
            label={REPORT_FIELDS.photosPerStep.label}
            value={`${options.photosPerStep}`}
            options={PER_STEP_OPTIONS}
            onChange={(count) => update({ photosPerStep: Number(count) as ReportOptions["photosPerStep"] })}
            disabled={photosOff}
          />
          <ChoiceRow
            label={REPORT_FIELDS.photoSize.label}
            value={options.photoSize}
            options={PHOTO_SIZE_OPTIONS}
            onChange={(photoSize) => update({ photoSize })}
            disabled={photosOff}
          />
        </FieldSet>

        <FieldSet className="gap-3">
          <FieldLegend className={LEGEND}>{REPORT_FIELDS.cover.label}</FieldLegend>
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
            label={REPORT_FIELDS.showClientName.label}
            checked={options.showClientName}
            onChange={(showClientName) => update({ showClientName })}
            disabled={readOnly}
          />
        </FieldSet>

        <FieldSet className="gap-1">
          <FieldLegend className={LEGEND}>{REPORT_FIELDS.content.label}</FieldLegend>
          <SwitchRow
            id={`${id}-summary`}
            label={REPORT_FIELDS.includeSummary.label}
            checked={options.includeSummary}
            onChange={(includeSummary) => update({ includeSummary })}
            disabled={readOnly}
          />
          <SwitchRow
            id={`${id}-signature`}
            label={REPORT_FIELDS.includeSignature.label}
            checked={options.includeSignature}
            onChange={(includeSignature) => update({ includeSignature })}
            disabled={readOnly}
          />
        </FieldSet>

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
      </div>
    </SectionFrame>
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
}: {
  label: string;
  value: T;
  options: readonly PillOption<T>[];
  onChange: (value: T) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 touch:min-h-11">
      {/* The pills are named by the same words (PillSwitch's label): read out once. */}
      <span aria-hidden className="text-sm leading-snug font-medium text-foreground touch:text-base">
        {label}
      </span>
      <PillSwitch value={value} options={options} onValueChange={onChange} label={label} disabled={disabled} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The preview, with Generate Report
 * ------------------------------------------------------------------ */

export function ReportPreviewCard({
  id,
  inspectionId,
  preview,
  generate,
  lastReport,
}: {
  id: string;
  inspectionId: string;
  preview: ReportPreview;
  generate: GenerateAvailability;
  lastReport: LastReport | null;
}) {
  const titleId = `${id}-title`;
  const paper = REPORT_PAGE_SIZES.find((size) => size.value === preview.pageSize)?.label ?? preview.pageSize;
  const count = preview.pages.length;
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
          <p className="text-sm text-muted-foreground tabular-nums touch:text-base">
            {count === 1 ? "1 page" : `${count} pages`} · {paper}
          </p>
        </div>
        <GenerateReport inspectionId={inspectionId} generate={generate} lastReport={lastReport} />
      </header>
      <div className="@container min-h-0 flex-1 overflow-y-auto bg-background p-4">
        {/* Two pages to a row once a page is wide enough to read: one on a desktop just wide enough for the sidebar. */}
        <ol aria-label="Report pages" className="grid gap-4 @min-[36rem]:grid-cols-2 @min-[64rem]:grid-cols-3">
          {preview.pages.map((page) => (
            <li key={page.number} data-page={page.number}>
              <PageThumbnail preview={preview} page={page} count={count} />
            </li>
          ))}
        </ol>
      </div>
      <p className="rounded-b-xl border-t border-border px-5 py-3 text-sm text-muted-foreground touch:text-base">{PREVIEW_CAPTION}</p>
    </section>
  );
}

/**
 * Generate Report: the AI report hand-off (sendToAiReport, BUILD_SPEC 9.1)
 * with the export as it is saved, the options in it. While it is not
 * allowed it waits, disabled, with why under it. Open Last Report opens the
 * link last stored, with when it was made where the audit log has it; the
 * action refreshes the page, which brings a new one.
 */
export function GenerateReport({
  inspectionId,
  generate,
  lastReport,
}: {
  inspectionId: string;
  generate: GenerateAvailability;
  lastReport: LastReport | null;
}) {
  const reasonId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [state, formAction, pending] = useActionState(async (previous: AiActionState, formData: FormData) => {
    const result = await sendToAiReport(previous, formData).catch(unreachable);
    if (result.status === "success") toast.success(result.message);
    return result;
  }, AI_ACTION_IDLE);

  // The button is disabled while the export is sent; its answer puts focus back on it.
  useEffect(() => {
    if (state.status !== "idle") focusIfLost(buttonRef.current, formRef.current);
  }, [state]);

  // A report made just now, until the refresh brings its stored link and time.
  const made = state.status === "success" && state.reportUrl && state.reportUrl !== lastReport?.url ? state.reportUrl : null;
  const link: LastReport | null = made ? { url: made, madeAt: null } : lastReport;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <form ref={formRef} action={formAction} className="grid max-w-full gap-1.5">
          <input type="hidden" name="inspectionId" value={inspectionId} />
          <Button
            ref={buttonRef}
            type="submit"
            disabled={!generate.allowed || pending}
            aria-describedby={generate.allowed ? undefined : reasonId}
            className="w-fit"
          >
            {pending ? <Spinner aria-hidden /> : <FileTextIcon aria-hidden />}
            {pending ? "Generating Report…" : "Generate Report"}
          </Button>
          {!generate.allowed && (
            <p id={reasonId} data-slot="generate-reason" className="text-sm text-muted-foreground touch:text-base">
              {generate.reason}
            </p>
          )}
        </form>
        {link && (
          <div className="grid gap-1.5">
            <Button asChild variant="outline" className="relative w-fit">
              <a href={link.url} target="_blank" rel="noreferrer">
                <ExternalLinkIcon aria-hidden />
                Open Last Report
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </Button>
            {link.madeAt && (
              <p className="text-sm text-muted-foreground touch:text-base">
                Made <time dateTime={link.madeAt.iso}>{link.madeAt.label}</time>
              </p>
            )}
          </div>
        )}
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-sm break-words text-fail touch:text-base">
          {state.message}
        </p>
      )}
      {state.status === "not_connected" && (
        <p role="status" className="text-sm text-muted-foreground touch:text-base">
          {state.message}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * A page of the preview
 * ------------------------------------------------------------------ */

/** A length in the page's millimetres: --mm is one millimetre of the page's width (PageThumbnail). */
const mm = (value: number) => `calc(var(--mm) * ${value})`;

/**
 * One page, white on the screen's ground at the paper's ratio. Every measure
 * is in the page's millimetres (--mm, from the page's own width), so a page
 * reads the same at any size: the running header, the blocks where the
 * layout put them, the footer with the footer note and the page number.
 */
export function PageThumbnail({ preview, page, count }: { preview: ReportPreview; page: PreviewPage; count: number }) {
  const { layout } = preview;
  const across = { left: mm(layout.margin), right: mm(layout.margin) };
  const style = { aspectRatio: `${preview.width} / ${preview.height}`, "--mm": `calc(100cqw / ${preview.width})` } as CSSProperties;
  return (
    <div
      data-slot="report-page-thumbnail"
      data-page-size={preview.pageSize}
      className="@container relative overflow-hidden rounded-[3px] bg-white shadow-sm ring-1 ring-border"
      style={style}
    >
      <div
        className="absolute flex items-center justify-between border-b border-slate-200"
        style={{ ...across, top: mm(layout.margin), height: mm(layout.header) }}
      >
        <span aria-hidden className="rounded-full bg-brand-100" style={{ width: mm(24), height: mm(3.5) }} />
        <span className="text-slate-600 tabular-nums" style={{ fontSize: mm(3.4) }}>
          {preview.header}
        </span>
      </div>
      {page.blocks.map((block) => (
        <PreviewBlockView key={`${block.kind}-${"key" in block ? block.key : ""}-${block.top}`} block={block} across={across} />
      ))}
      <div
        className="absolute flex items-center justify-between gap-[1cqw] border-t border-slate-200 text-slate-600"
        style={{ ...across, bottom: mm(layout.margin), height: mm(layout.footer), fontSize: mm(3.2) }}
      >
        <span data-slot="report-footer-note" className="min-w-0 truncate">
          {preview.footer}
        </span>
        <span className="shrink-0 tabular-nums">
          Page {page.number} of {count}
        </span>
      </div>
    </div>
  );
}

/** A block of the layout, drawn quietly: the words it would carry, lines and tiles for the rest. */
function PreviewBlockView({ block, across }: { block: PlacedBlock; across: CSSProperties }) {
  const box: CSSProperties = { ...across, top: mm(block.top), height: mm(block.height) };
  switch (block.kind) {
    case "cover":
      return (
        <div data-block="cover" className="absolute flex flex-col justify-center" style={{ ...box, gap: mm(2) }}>
          <span aria-hidden className="rounded-full bg-brand-500" style={{ width: mm(14), height: mm(1.4) }} />
          <p className="line-clamp-2 font-display leading-tight font-bold text-slate-900" style={{ fontSize: mm(8) }}>
            {block.title}
          </p>
          {block.client && (
            <p data-slot="report-client" className="truncate text-slate-700" style={{ fontSize: mm(5) }}>
              {block.client}
            </p>
          )}
          <p className="text-slate-600 tabular-nums" style={{ fontSize: mm(4) }}>
            {block.refNo}
          </p>
        </div>
      );
    case "section":
      return (
        <div data-block="section" data-step={block.key} className="absolute flex flex-col" style={{ ...box, gap: mm(2) }}>
          <BlockTitle title={block.title}>{block.label}</BlockTitle>
          <div aria-hidden className="flex flex-1 flex-col overflow-hidden border border-slate-200" style={{ borderRadius: mm(1.2) }}>
            <div className="bg-slate-100" style={{ height: mm(5) }} />
            <div className="flex-1 border-t border-slate-200" />
            <div className="flex-1 border-t border-slate-200" />
            <div className="flex-1 border-t border-slate-200" />
          </div>
        </div>
      );
    case "photos":
      return (
        <div
          data-block="photos"
          data-step={block.key}
          data-count={block.count}
          data-size={block.size}
          role="img"
          aria-label={`${block.label}: ${block.count === 1 ? "1 photo" : `${block.count} photos`}`}
          className="absolute grid content-start"
          style={{ ...box, gridTemplateColumns: `repeat(${block.perRow}, minmax(0, 1fr))`, gap: mm(3) }}
        >
          {Array.from({ length: block.count }, (_, index) => (
            <span key={index} className="flex aspect-[4/3] items-center justify-center bg-slate-100" style={{ borderRadius: mm(1.2) }}>
              <ImageIcon aria-hidden className="text-slate-400" style={{ width: mm(6), height: mm(6) }} />
            </span>
          ))}
        </div>
      );
    case "summary":
      return (
        <div data-block="summary" className="absolute flex flex-col" style={{ ...box, gap: mm(2.5) }}>
          <BlockTitle>Inspection Summary</BlockTitle>
          {[100, 96, 98, 64].map((width) => (
            <span key={width} aria-hidden className="rounded-full bg-slate-200" style={{ width: `${width}%`, height: mm(2) }} />
          ))}
        </div>
      );
    case "signature":
      return (
        <div data-block="signature" className="absolute flex flex-col justify-end" style={{ ...box, gap: mm(1.5) }}>
          <p className="text-slate-600" style={{ fontSize: mm(3.6) }}>
            Inspector Signature
          </p>
          <span aria-hidden className="border-b border-slate-400" style={{ width: mm(70), height: mm(10) }} />
          <p className="truncate text-slate-700" style={{ fontSize: mm(4) }}>
            {block.inspector}
          </p>
        </div>
      );
  }
}

/** A block's title bar: its words larger than a report would print them, so a thumbnail reads. */
function BlockTitle({ title, children }: { title?: string; children: string }) {
  return (
    <p
      title={title}
      className="flex shrink-0 items-center truncate bg-brand-50 font-semibold text-brand-700"
      style={{ height: mm(11), paddingInline: mm(3), fontSize: mm(6.5), borderRadius: mm(1.5) }}
    >
      <span className="truncate">{children}</span>
    </p>
  );
}
