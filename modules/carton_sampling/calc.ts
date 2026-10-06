// Result (BUILD_SPEC 6.1 carton_sampling): "fail" on any error of 6.2 rule 6
// (a carton entered twice, a carton outside 1 to the order quantity, more
// carton numbers than cases sampled); "pass" when a size lists exactly the
// cases sampled, all valid; "not done" until then (6.2 rule 5). The list
// flows forward to the box pickers of dispensing and labelling (rule 7).
import { formatCount } from "@/lib/aql";
import type { PerSizeResult } from "@/lib/schemas";
import {
  errorIssue,
  perSizeResults,
  resultFromSizes,
  samplingFor,
  sizeLabel,
  worstStatus,
  type CalcInput,
  type CalcIssue,
  type CalcOutput,
  type ContextContribution,
  type ContributeInput,
  type InspectionContext,
} from "@/modules/_framework";
import { GRID_COLUMNS, type CartonSamplingConfig } from "./config";
import { enteredCartons, type CartonSamplingData } from "./schema";

export type CartonSizeComputed = {
  /** Carton numbers entered, a duplicate counted each time: must equal the cases sampled. */
  samplingQuantity: number;
  /** Distinct carton numbers entered. */
  unique: number;
  /** Cases sampled (sampling_plan); null until entered. */
  sampledCases: number | null;
  /** Cases ordered (order_lots), the highest carton number; null until entered. */
  orderQty: number | null;
};

export type CartonSamplingComputed = {
  /** Per ordered size. */
  sizes: Record<string, CartonSizeComputed>;
};

export function calcCartonSampling({
  data,
  context,
}: CalcInput<CartonSamplingData, CartonSamplingConfig>): CalcOutput<CartonSamplingComputed> {
  const issues: CalcIssue[] = [];
  const sizes: Record<string, CartonSizeComputed> = {};
  const perSize = perSizeResults(context.sizes, (size) => {
    const checked = checkSize(size, data.sizes[size]?.cartonNumbers ?? [], context);
    sizes[size] = checked.computed;
    issues.push(...checked.issues);
    return checked.result;
  });
  return { result: resultFromSizes(perSize, summarise(perSize, sizes, context)), computed: { sizes }, issues };
}

export function contributeCartonSampling({
  data,
}: ContributeInput<CartonSamplingData, CartonSamplingConfig>): ContextContribution {
  return { cartons: Object.fromEntries(Object.entries(data.sizes).map(([size, row]) => [size, enteredCartons(row)])) };
}

/** Where a carton sits in the report's grid: "row 2 column 10" for the 20th. */
export function gridCell(index: number): string {
  return `row ${Math.floor(index / GRID_COLUMNS) + 1} column ${(index % GRID_COLUMNS) + 1}`;
}

type Problem = { issue: CalcIssue; brief: string };

function checkSize(
  size: string,
  cells: readonly (number | null)[],
  context: InspectionContext,
): { computed: CartonSizeComputed; issues: CalcIssue[]; result: PerSizeResult } {
  const name = sizeLabel(context, size);
  const orderQty = context.order[size]?.qtyCases ?? null;
  const sampledCases = samplingFor(context, size).cases;

  const positions = new Map<number, number[]>();
  cells.forEach((carton, index) => {
    if (carton !== null) positions.set(carton, [...(positions.get(carton) ?? []), index]);
  });
  const count = cells.filter((carton) => carton !== null).length;

  const problems: Problem[] = [];
  const report = (code: string, brief: string, index?: number) => {
    const path = index === undefined ? ["sizes", size, "cartonNumbers"] : ["sizes", size, "cartonNumbers", index];
    problems.push({ issue: errorIssue(code, `Size ${name}: ${brief}.`, { size, path }), brief });
  };
  // In grid order, so the issue list reads like the grid.
  cells.forEach((carton, index) => {
    if (carton === null) return;
    if (orderQty !== null && carton > orderQty) {
      report(
        "carton_out_of_range",
        `Carton ${carton} is not between 1 and ${formatCount(orderQty)}, the order quantity (${gridCell(index)})`,
        index,
      );
    }
    const at = positions.get(carton) ?? [];
    if (at.length > 1 && at[1] === index) {
      const times = at.length === 2 ? "twice" : `${at.length} times`;
      report("carton_duplicate", `Carton ${carton} is entered ${times} (${at.map(gridCell).join(", ")})`, index);
    }
  });
  if (sampledCases !== null && count > sampledCases) {
    report(
      "carton_count_above_cases",
      `${counted(count, "carton number")}, but the sampling plan has ${counted(sampledCases, "case")}`,
    );
  }

  const computed: CartonSizeComputed = { samplingQuantity: count, unique: positions.size, sampledCases, orderQty };
  return { computed, issues: problems.map((problem) => problem.issue), result: sizeResult(problems, computed) };
}

function sizeResult(problems: readonly Problem[], computed: CartonSizeComputed): PerSizeResult {
  const { samplingQuantity: count, sampledCases, orderQty } = computed;
  if (problems.length > 0) {
    const more = problems.length > 1 ? `; ${problems.length - 1} more` : "";
    return { status: "fail", summary: `${problems[0].brief}${more}.` };
  }
  const waiting = [
    orderQty === null ? "the order quantity" : null,
    sampledCases === null ? "the sampled cases" : null,
  ].filter((missing): missing is string => missing !== null);
  if (waiting.length > 0) {
    const entered = counted(count, "carton number");
    return { status: "not_done", summary: `Waiting for ${waiting.join(" and ")}; ${entered} entered.` };
  }
  if (sampledCases === 0) return { status: "not_done", summary: "No cases sampled." };
  if (sampledCases !== null && count < sampledCases) {
    return { status: "not_done", summary: `${formatCount(count)} of ${counted(sampledCases, "carton number")}.` };
  }
  return {
    status: "pass",
    summary: `${counted(count, "carton number")}, unique and between 1 and ${formatCount(orderQty ?? 0)}.`,
  };
}

/** "1 case", "50 carton numbers". */
function counted(count: number, noun: string): string {
  return `${formatCount(count)} ${count === 1 ? noun : `${noun}s`}`;
}

function summarise(
  perSize: Readonly<Record<string, PerSizeResult>>,
  computed: Readonly<Record<string, CartonSizeComputed>>,
  context: InspectionContext,
): string {
  const sizes = context.sizes;
  if (sizes.length === 0) return "No sizes ordered yet.";
  const describe = (size: string) => `Size ${sizeLabel(context, size)}: ${perSize[size]?.summary ?? ""}`;
  if (sizes.length === 1) return describe(sizes[0]);
  const worst = worstStatus(sizes.map((size) => perSize[size].status));
  if (worst === "pass") {
    const counts = sizes.map((size) => `${sizeLabel(context, size)} (${formatCount(computed[size].samplingQuantity)})`);
    return `Carton numbers complete, unique and within the order quantity for size ${counts.join(", ")}.`;
  }
  return sizes
    .filter((size) => perSize[size].status === worst)
    .map(describe)
    .join(" ");
}
