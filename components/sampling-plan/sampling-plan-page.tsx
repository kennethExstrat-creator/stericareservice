// The sampling plan for the manufacturer (Kenneth, 27 October 2026; docs/BUILD_SPEC.md section 10): one A4
// landscape page in the design he sent, drawn from its model (lib/sampling-plan/model.ts). At the left, the
// product type over the product's name, a line asking the factory to have the samples ready, The Sample at a
// Glance (the big numbers: cases to pull, inner boxes taken, gloves drawn with those put back, and the gloves
// sampled, tinted teal) and the Order it comes from (each size's chip, lots, cases and gloves, and the totals).
// At the right, the details card (client, PO / SO number, manufacturer, inspection date) and Sampling Plan by Size
// (plan-table.tsx), with the code letters the samples follow under it. Pure markup with no hooks, on the report's
// primitives (components/report: the theme, the size chips, the cards, the table): the print route renders it on
// the server at true size.
import { InfoCard, KeyValueGrid } from "@/components/report/info-card";
import { ReportTable, type ReportColumn } from "@/components/report/report-table";
import { SizeChip } from "@/components/report/size-chip";
import { TYPE } from "@/components/report/theme";
import { formatCount } from "@/lib/format";
import {
  GLANCE_TITLE,
  ORDER_TITLE,
  PLAN_TABLE_TITLE,
  type GlanceLine,
  type SamplingPlanModel,
  type SamplingPlanOrder,
  type UnitWords,
} from "@/lib/sampling-plan/model";
import { cn } from "@/lib/utils";
import { SamplingPlanFrame } from "./frame";
import { NO_COUNT, SamplingPlanTable } from "./plan-table";

/** A card's heading in this design: "The Sample at a Glance", "Order", "Sampling Plan by Size". */
const BLOCK = "font-sans text-[10.5pt] leading-[1.3] font-semibold tracking-[-0.01em] text-slate-900";

/** More sizes than the design's five at most: the order's rows close up, so the page still holds them. */
const ROOMY_SIZES = 5;

export type SamplingPlanDocumentProps = { model: SamplingPlanModel; className?: string };

/** The plan as a printable document: its one page, which the print route's rules put on one sheet. */
export function SamplingPlanDocument({ model, className }: SamplingPlanDocumentProps) {
  return (
    <div data-sampling-plan data-page-size="a4" data-orientation="landscape" className={cn("flex flex-col items-center", className)}>
      <SamplingPlanFrame chrome={model.chrome}>
        <SamplingPlanBody model={model} />
      </SamplingPlanFrame>
    </div>
  );
}

export function SamplingPlanBody({ model }: { model: SamplingPlanModel }) {
  const compact = model.sizes.length > ROOMY_SIZES;
  return (
    <div data-slot="sampling-plan-body" className="grid h-full grid-cols-[79.4mm_minmax(0,1fr)] gap-x-[8.5mm]">
      <div className="flex min-w-0 flex-col">
        <PlanHeading kicker={model.kicker} title={model.title} lead={model.lead} />
        {model.glance.length > 0 && <GlanceCard lines={model.glance} className="mt-[4.1mm]" />}
        {model.order && (
          <OrderCard order={model.order} unit={model.unit} templateSizes={model.templateSizes} compact={compact} className="mt-[4.2mm]" />
        )}
      </div>
      <div className="flex min-w-0 flex-col">
        <InfoCard className="px-[5.6mm] py-[2.6mm]">
          <KeyValueGrid
            columns={4}
            // As wide as each value needs, the space between them: a long PO stays on one line where it can.
            className="grid-cols-[repeat(4,auto)] justify-between [&_dd]:text-[11pt] [&_dd]:[overflow-wrap:break-word]"
            items={model.facts.map((fact) => ({ key: fact.key, label: fact.label, value: fact.value, muted: !fact.stated }))}
          />
        </InfoCard>
        <h3 className={cn("mt-[4.3mm]", BLOCK)}>{PLAN_TABLE_TITLE}</h3>
        <SamplingPlanTable
          className="mt-[2.4mm]"
          sizes={model.sizes}
          templateSizes={model.templateSizes}
          groups={model.groups}
          showTotal={model.showTotal}
        />
        {model.note && (
          <p data-slot="sampling-plan-note" className={cn("mt-[1.7mm] text-slate-600", TYPE.small)}>
            {model.note}
          </p>
        )}
      </div>
    </div>
  );
}

/** The product type after a short teal dash, as the report's kickers are, the product's name, and the ask. */
function PlanHeading({ kicker, title, lead }: { kicker: string; title: string; lead: string }) {
  return (
    <header data-slot="sampling-plan-heading" className="flex flex-col">
      <p className={cn("flex items-center gap-[2.3mm] text-brand-600", TYPE.kicker)}>
        <span aria-hidden className="h-[0.5mm] w-[4.7mm] shrink-0 rounded-full bg-accent-500" />
        <span>{kicker}</span>
      </p>
      <h2 className="mt-[1.5mm] line-clamp-3 font-sans text-[18pt] leading-[1.15] font-bold tracking-[-0.02em] text-slate-900 [overflow-wrap:anywhere]">
        {title}
      </h2>
      <p className="mt-[2mm] text-[9.5pt] leading-[1.5] text-slate-600">{lead}</p>
    </header>
  );
}

/**
 * The Sample at a Glance: each total as a big number with its words, a
 * hairline between, and the gloves sampled last, in a teal box.
 */
function GlanceCard({ lines, className }: { lines: readonly GlanceLine[]; className?: string }) {
  return (
    <InfoCard className={cn("px-[2.9mm] pt-[3.2mm] pb-[2.6mm]", className)}>
      <h3 className={cn("px-[1.8mm] pb-[2.5mm]", BLOCK)}>{GLANCE_TITLE}</h3>
      <ul data-slot="sampling-plan-glance">
        {lines.map((line) => (
          <li
            key={line.key}
            data-glance={line.key}
            data-highlight={line.highlight || undefined}
            className={cn(
              "grid grid-cols-[18mm_minmax(0,1fr)] items-center gap-x-[3.2mm]",
              line.highlight ? "mt-[1.6mm] rounded-[2mm] border-[0.3mm] border-accent-200 bg-accent-50 py-[1.6mm]" : "border-t-[0.25mm] border-slate-200 py-[1.7mm]",
            )}
          >
            <span className={cn("text-right text-[16pt] leading-none font-bold tabular-nums", line.highlight ? "text-accent-700" : "text-brand-600")}>
              {formatCount(line.value)}
            </span>
            <span className={cn("min-w-0 text-[9pt] leading-[1.3]", line.highlight ? "font-bold text-slate-900" : "text-slate-600")}>{line.text}</span>
          </li>
        ))}
      </ul>
    </InfoCard>
  );
}

const capitalised = (words: string) => `${words.charAt(0).toUpperCase()}${words.slice(1)}`;

/** The Order: the gloves per case at the right of its heading, then each size's lots, cases and gloves, and the totals. */
function OrderCard({
  order,
  unit,
  templateSizes,
  compact,
  className,
}: {
  order: SamplingPlanOrder;
  unit: UnitWords;
  templateSizes: readonly string[];
  compact: boolean;
  className?: string;
}) {
  const columns: ReportColumn[] = [
    { key: "size", label: "Size", width: "19%" },
    { key: "lots", label: "Lot no.", width: "31%" },
    { key: "cases", label: "Cases", numeric: true, width: "19%" },
    { key: "gloves", label: capitalised(unit.many), numeric: true, width: "31%" },
  ];
  const chip = compact ? "h-[4.4mm] min-w-[7.4mm] text-[8pt] leading-none" : undefined;
  return (
    <InfoCard className={cn("px-[2.9mm] pt-[3.2mm] pb-[1.6mm]", className)}>
      <div className="flex items-baseline justify-between gap-[4mm] px-[2mm]">
        <h3 className={BLOCK}>{ORDER_TITLE}</h3>
        {order.glovesPerCase !== null && (
          <p className={cn("text-slate-600 tabular-nums", TYPE.small)}>
            {formatCount(order.glovesPerCase)} {unit.many} per case
          </p>
        )}
      </div>
      <ReportTable
        // The totals row under a hairline, as the design has it, not the report's dark rule.
        className="mt-[0.7mm] [&_tfoot_tr]:border-t-0"
        caption="The order by size"
        dense={compact}
        columns={columns}
        rows={order.lines.map((line) => ({
          key: line.size,
          cells: {
            size: <SizeChip size={line.size} label={line.label} templateSizes={templateSizes} className={chip} />,
            lots: line.lots.length > 0 ? line.lots.join(", ") : NO_COUNT,
            cases: formatCount(line.cases),
            gloves: line.gloves === null ? NO_COUNT : formatCount(line.gloves),
          },
        }))}
        totals={{
          size: "Total",
          cases: formatCount(order.totalCases),
          gloves: order.totalGloves === null ? NO_COUNT : formatCount(order.totalGloves),
        }}
      />
    </InfoCard>
  );
}
