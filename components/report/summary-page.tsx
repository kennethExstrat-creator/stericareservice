// The report's first page, the Summary (the design's page 1): the kicker over the
// product's name, the overall conclusion card (the result in the status's
// colour with its mark, the verdict from the checks, when it was concluded)
// beside the details card (client, PO, manufacturer, dates, the factory's
// address), the order mix by size, the inspector's Inspection Summary and
// Results by Check. A summary too long for page 1 prints on a page of its
// own after it (SummaryModel.summaryPlacement).
import type { ReactNode } from "react";
import { RichTextView } from "@/components/qc/rich-text-view";
import { formatCount } from "@/lib/format";
import type { CheckRow } from "@/lib/report/checks";
import { shareText } from "@/lib/report/format";
import type { OrderMix, ReportChrome, ReportConclusion, ReportStatus, SummaryModel, SummaryText } from "@/lib/report/model";
import { cn } from "@/lib/utils";
import { InfoCard, KeyValueGrid } from "./info-card";
import { ReportTable, type ReportColumn } from "./report-table";
import { BlockHeading, SectionHeading } from "./section-heading";
import { StackedBar, StackedLegend } from "./stacked-bar";
import { StatusChip, StatusTick } from "./status-chip";
import { sizeTone, TYPE } from "./theme";

type TemplateSizes = readonly { value: string; label: string }[];

/** The summary's pages: page 1, and the Inspection Summary's own page when page 1 cannot hold it. */
export function summaryPages({ summary, chrome, sizes = [] }: { summary: SummaryModel; chrome: ReportChrome; sizes?: TemplateSizes }): ReactNode[] {
  const first = <SummaryPage summary={summary} chrome={chrome} sizes={sizes} />;
  if (summary.summaryPlacement === "first" || !summary.inspectionSummary) return [first];
  return [
    first,
    <div key="summary-text" className="flex flex-col gap-[5mm]">
      <SectionHeading kicker={summary.kicker} title="Inspection Summary" />
      <SummaryTextCard text={summary.inspectionSummary} draft={chrome.draft} heading={false} />
    </div>,
  ];
}

export function SummaryPage({ summary, chrome, sizes = [] }: { summary: SummaryModel; chrome: ReportChrome; sizes?: TemplateSizes }) {
  return (
    <div data-slot="report-summary" className="flex flex-col gap-[4.6mm]">
      <SectionHeading kicker={summary.kicker} title={summary.title} cover />
      <div className="grid grid-cols-[62mm_minmax(0,1fr)] gap-[4.6mm]">
        <ConclusionCard conclusion={summary.conclusion} />
        <InfoCard className="py-[3.8mm]">
          <KeyValueGrid
            className="gap-y-[2mm] [&_dd]:leading-[1.3] [&_dt]:leading-[1.35]"
            items={summary.facts.map((fact) => ({ key: fact.key, label: fact.label, value: fact.value, wide: fact.wide, muted: !fact.stated }))}
          />
        </InfoCard>
      </div>
      {summary.orderMix && <OrderMixBlock mix={summary.orderMix} sizes={sizes} />}
      {summary.summaryPlacement === "first" && summary.inspectionSummary && <SummaryTextCard text={summary.inspectionSummary} draft={chrome.draft} />}
      {summary.checks && <ChecksBlock rows={summary.checks} />}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The conclusion
 * ------------------------------------------------------------------ */

/** The card in its result's colours: passed green, failed red, on hold amber, not yet concluded slate. */
const CONCLUSION_TONE: Readonly<Record<ReportStatus, { card: string; text: string; rule: string }>> = {
  pass: { card: "border-pass-border bg-pass-tint", text: "text-pass", rule: "border-pass-border" },
  fail: { card: "border-fail-border bg-fail-tint", text: "text-fail", rule: "border-fail-border" },
  hold: { card: "border-hold-border bg-hold-tint", text: "text-hold", rule: "border-hold-border" },
  warn: { card: "border-warn-border bg-warn-tint", text: "text-warn", rule: "border-warn-border" },
  not_done: { card: "border-dashed border-not-done-border bg-not-done-tint", text: "text-not-done", rule: "border-not-done-border" },
};

export function ConclusionCard({ conclusion }: { conclusion: ReportConclusion }) {
  const tone = CONCLUSION_TONE[conclusion.status];
  // The template's word fits at the design's size; "Not Concluded" takes a smaller one.
  const long = conclusion.label.length > 8;
  return (
    <section
      data-slot="report-conclusion"
      data-status={conclusion.status}
      className={cn("flex flex-col rounded-[2.8mm] border-[0.4mm] px-[5mm] py-[3.8mm]", tone.card)}
    >
      <h3 className={cn(TYPE.kicker, tone.text)}>Overall Conclusion</h3>
      <div className="mt-[2.4mm] flex items-center gap-[3.2mm]">
        <StatusTick status={conclusion.status} size={long ? 8 : 10} />
        <p
          data-slot="report-conclusion-result"
          className={cn("min-w-0 leading-none font-bold tracking-[-0.02em] uppercase", long ? "text-[16pt]" : "text-[29pt]", tone.text)}
        >
          {conclusion.label}
        </p>
      </div>
      <p data-slot="report-verdict" className={cn("mt-[2.8mm] mb-[2.6mm]", TYPE.body, "text-[9.5pt] leading-[1.45]", tone.text)}>
        {conclusion.verdict}
      </p>
      {conclusion.date && (
        <p className={cn("mt-auto border-t-[0.3mm] pt-[3mm]", tone.rule, tone.text, TYPE.small)}>Concluded {conclusion.date}</p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Order Mix by Size
 * ------------------------------------------------------------------ */

export function OrderMixBlock({ mix, sizes = [] }: { mix: OrderMix; sizes?: TemplateSizes }) {
  const values = sizes.map((size) => size.value);
  // Each size in its own blue, as on the sampling plan: S light blue, M blue, L dark blue, XL navy.
  const segments = mix.rows.map((row) => ({ key: row.size, label: row.label, value: row.cases, tone: sizeTone(row.size, values) }));
  const described = mix.rows.map((row) => `${row.label} ${shareText(row.share)}`).join(", ");
  return (
    <section data-slot="report-order-mix" className="flex flex-col gap-[2.4mm]">
      <BlockHeading
        title="Order Mix by Size"
        aside={
          <span className="tabular-nums">
            <strong className="font-bold text-slate-900">{formatCount(mix.totalCases)}</strong> {mix.totalCases === 1 ? "carton" : "cartons"}
            {mix.totalGloves !== null && (
              <>
                {" · "}
                <strong className="font-bold text-slate-900">{formatCount(mix.totalGloves)}</strong> {mix.unitWord}
              </>
            )}
            {mix.glovesPerCase !== null && ` · ${formatCount(mix.glovesPerCase)} ${mix.unitWord} per carton`}
          </span>
        }
      />
      <StackedBar segments={segments} label={`Order mix by size: ${described}.`} />
      <StackedLegend
        segments={segments}
        detail={(_, index) => `${formatCount(mix.rows[index].cases)} ${mix.rows[index].cases === 1 ? "carton" : "cartons"} · ${shareText(mix.rows[index].share)}`}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The Inspection Summary
 * ------------------------------------------------------------------ */

/** The inspector's summary on a soft blue card; while it is a draft with none written, a quiet line says so. */
export function SummaryTextCard({ text, draft, heading = true }: { text: SummaryText; draft: boolean; heading?: boolean }) {
  if (text.kind === "empty" && !draft) return null;
  return (
    <InfoCard tone="soft" title={heading ? "Inspection Summary" : undefined}>
      {/* The app's own rendering (RichTextView), its lines set a little closer for print, as the design sets them. */}
      <div data-slot="report-inspection-summary" className={cn("text-slate-900 [&>div]:leading-[1.5]", TYPE.body, "text-[9.2pt]")}>
        {text.kind === "rich" && <RichTextView doc={text.doc} />}
        {text.kind === "plain" &&
          text.paragraphs.map((paragraph, index) => (
            <p key={index} className="whitespace-pre-wrap not-first:mt-[1.6mm]">
              {paragraph}
            </p>
          ))}
        {text.kind === "empty" && <p className="text-slate-600 italic">No inspection summary has been written yet.</p>}
      </div>
    </InfoCard>
  );
}

/* ------------------------------------------------------------------ *
 * Results by Check
 * ------------------------------------------------------------------ */

const CHECK_COLUMNS: readonly ReportColumn[] = [
  { key: "check", label: "Check", width: "24%", strong: true },
  { key: "criterion", label: "Criterion", width: "30%", muted: true },
  { key: "result", label: "Result", width: "31%" },
  { key: "status", label: "Status", width: "15%" },
];

export function ChecksBlock({ rows }: { rows: readonly CheckRow[] }) {
  return (
    <section data-slot="report-checks" className="flex flex-col gap-[1mm]">
      <BlockHeading title="Results by Check" />
      {rows.length === 0 ? (
        <p className={cn("text-slate-600", TYPE.body)}>No checks are recorded yet.</p>
      ) : (
        <ReportTable
          caption="Results by check"
          columns={CHECK_COLUMNS}
          rows={rows.map((row) => ({
            key: row.key,
            cells: {
              check: row.check,
              criterion: row.criterion ?? "—",
              result: (
                <>
                  {row.result ?? <span className="text-slate-600">Not entered</span>}
                  {row.sizesNote && <span className={cn("block font-semibold text-fail", TYPE.small)}>{row.sizesNote}</span>}
                </>
              ),
              status: <StatusChip status={row.status} size="sm" />,
            },
          }))}
        />
      )}
    </section>
  );
}
