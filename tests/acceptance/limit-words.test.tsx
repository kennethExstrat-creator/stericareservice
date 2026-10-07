// Phase 2 acceptance (BUILD_SPEC 11: the template's labels verbatim): the
// limit rows of the labelling and visual sections read as each example
// report prints them. The words come from the seed template (seed-bundle.json),
// the numbers from calc, through each module's own capture body, as the
// inspector sees them: STD_EG prints its critical row "Acc. = 0 / Rej. = 1"
// and its labelling rows "Accept 0 / Reject 1"; SAFEDON_EG the other way round.
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LabelingCapture from "@/modules/labeling/Capture";
import VisualCapture from "@/modules/visual/Capture";
import { SAFEDON_EG_EXPECTED } from "@/tests/fixtures/examples";
import { evaluateSafedonEg, evaluateStdEg, type Evaluated } from "./examples";

const noop = () => {};

/**
 * The props the capture screen gives a module's body, from the evaluated
 * inspection: the data and config as the module's own schemas parsed them,
 * the template's labels over the defaults, calc's evaluation.
 */
function captureProps(evaluated: Evaluated, key: "labeling" | "visual") {
  const evaluation = evaluated.module(key);
  return {
    data: evaluation.data,
    config: evaluation.config,
    title: evaluation.title,
    labels: evaluation.labels,
    context: evaluated.context,
    evaluation,
    focusPath: null,
    readOnly: false,
    onChange: noop,
    onFocusChange: noop,
  };
}

/** Every limit row's line, as read out ("Acc. = 0 / Rej. = 1"), in page order. */
function limitLines(html: string): string[] {
  return Array.from(html.matchAll(/<span class="sr-only">([^<]* \d+ \/ [^<]* \d+)<\/span>/g), (match) => match[1]);
}

function labelling(evaluated: Evaluated): string[] {
  const props = captureProps(evaluated, "labeling") as unknown as ComponentProps<typeof LabelingCapture>;
  return limitLines(renderToStaticMarkup(<LabelingCapture {...props} />));
}

function visual(evaluated: Evaluated): string[] {
  const props = captureProps(evaluated, "visual") as unknown as ComponentProps<typeof VisualCapture>;
  return limitLines(renderToStaticMarkup(<VisualCapture {...props} />));
}

describe("the reports' limit words (expected results A and B)", () => {
  const std = evaluateStdEg({ corrected: true });
  const safedon = evaluateSafedonEg();

  it("STD_EG: labelling Accept 0 / Reject 1 at both levels; the critical row Acc. = 0 / Rej. = 1", () => {
    expect(labelling(std)).toEqual(["Accept 0 / Reject 1", "Accept 0 / Reject 1"]);
    // Size M: critical, then major and minor at code letter N (21 / 22).
    expect(visual(std)).toEqual(["Acc. = 0 / Rej. = 1", "Accept 21 / Reject 22", "Accept 21 / Reject 22"]);
  });

  it("SAFEDON_EG: labelling Acc. = 0 / Rej. = 1 at both levels; the critical row Accept 0 / Reject 1", () => {
    expect(labelling(safedon)).toEqual(["Acc. = 0 / Rej. = 1", "Acc. = 0 / Rej. = 1"]);
    // Class by class, size by size in the order of the report: critical 0 / 1 everywhere.
    const expected = (["critical", "major", "minor"] as const).flatMap((cls) =>
      safedon.context.sizes.map((size) => {
        const limits = Object.entries(SAFEDON_EG_EXPECTED.visual[cls]).find(([key]) => key === size)?.[1];
        if (!limits) throw new Error(`expected-results A has no ${cls} limits for size ${size}`);
        return `Accept ${limits.accept} / Reject ${limits.reject}`;
      }),
    );
    expect(expected.slice(0, 4)).toEqual(Array.from({ length: 4 }, () => "Accept 0 / Reject 1"));
    expect(visual(safedon)).toEqual(expected);
  });
});
