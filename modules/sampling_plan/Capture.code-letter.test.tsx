// The Code Letter row's Reduce dialog (Kenneth, 27 October 2026: "reducing
// code letter go to Audit Log"), drawn on the server with its dialogs in
// place (a portal draws nothing on the server; the mock keeps each part's
// classes): one per size, the change it makes, the reason it waits for,
// Cancel and Reduce. Taps and typing are the browser's, checked by the
// integrator; what Reduce hands the data updater is withCodeLetterStep, and
// the reason it takes is codeLetterReason (schema.test.ts).
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/dialog", () => {
  const Part = ({ children, className }: { children?: ReactNode; className?: string }) => <div className={className}>{children}</div>;
  return {
    Dialog: Part,
    DialogClose: ({ children }: { children?: ReactNode }) => <div data-dialog-close="">{children}</div>,
    DialogContent: ({ children, className }: { children?: ReactNode; className?: string }) => (
      <div data-dialog-content="" className={className}>
        {children}
      </div>
    ),
    DialogDescription: ({ children }: { children?: ReactNode }) => <p data-dialog-description="">{children}</p>,
    DialogFooter: Part,
    DialogHeader: Part,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2 data-dialog-title="">{children}</h2>,
    DialogTrigger: Part,
  };
});

import { buildInspectionContext, evaluateInspection, type InspectionData } from "@/modules/_framework";
import { makeTestTemplate, TEST_INSPECTOR } from "@/modules/_framework/testing";
import { SAFEDON_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { ENGINE_REGISTRY, exampleData, samplingPlanData } from "./__fixtures__/examples";
import type { SamplingPlanComputed } from "./calc";
import Capture from "./Capture";
import { SAMPLING_PLAN_DEFAULT_CONFIG, SAMPLING_PLAN_LABELS, type SamplingPlanConfig } from "./config";
import type { SamplingPlanData, SamplingSize } from "./schema";

const LEVEL_I: SamplingPlanConfig = { ...SAMPLING_PLAN_DEFAULT_CONFIG, inspectionLevel: "I" };

/** SAFEDON_EG's sizes at level I: XS at its lot's L, S at its lot's N with 500 gloves, M lowered to M, L with no letter. */
function data(): InspectionData {
  const plan = samplingPlanData(SAFEDON_EG_EXAMPLE);
  const sizes: Record<string, SamplingSize> = {
    XS: { ...plan.sizes.XS, codeLetter: "L", gloves: 200 },
    S: { ...plan.sizes.S, codeLetter: "N", gloves: 500 },
    M: { ...plan.sizes.M, codeLetter: "M", gloves: 315, codeLetterReason: "Consistent high-quality factory" },
    L: { ...plan.sizes.L, codeLetter: null },
  };
  return exampleData(SAFEDON_EG_EXAMPLE, { sampling_plan: { sizes } });
}

function render(readOnly = false): string {
  const template = makeTestTemplate(ENGINE_REGISTRY, ["order_lots", "packing_config", { key: "sampling_plan", config: LEVEL_I }]);
  const inspection = data();
  const context = buildInspectionContext({ template, data: inspection, meta: { inspector: TEST_INSPECTOR } }, ENGINE_REGISTRY);
  const found = evaluateInspection({ template, data: inspection, context }, ENGINE_REGISTRY).modules.find(
    (entry) => entry.key === "sampling_plan",
  );
  if (!found) throw new Error("sampling_plan was not evaluated");
  return renderToStaticMarkup(
    <Capture
      data={inspection.modules.sampling_plan as SamplingPlanData}
      config={LEVEL_I}
      title="Sampling Plan"
      labels={SAMPLING_PLAN_LABELS}
      context={context}
      evaluation={{ ...found, computed: found.computed as SamplingPlanComputed }}
      focusPath={null}
      readOnly={readOnly}
      onChange={() => {}}
    />,
  );
}

/** Each Reduce dialog's form, in size order. */
function reduceForms(html: string): string[] {
  return Array.from(html.matchAll(/<form[^>]*>(?:(?!<\/form>)[\s\S])*?<h2 data-dialog-title="">Reduce Code Letter[\s\S]*?<\/form>/g), (match) => match[0]);
}

describe("sampling_plan's Reduce dialog (Kenneth, 27 October 2026)", () => {
  it("opens one per size with a letter to go down to, titled with the size", () => {
    const forms = reduceForms(render());
    expect(forms.map((form) => /<h2 data-dialog-title="">([^<]+)<\/h2>/.exec(form)?.[1])).toEqual([
      "Reduce Code Letter for Size XS",
      "Reduce Code Letter for Size S",
      "Reduce Code Letter for Size M",
    ]);
    // L has no letter, so no Reduce to open; Raise opens nothing.
    expect(render()).not.toContain("Reduce Code Letter for Size L");
    expect(render()).not.toContain("Raise Code Letter");
  });

  it("says what changes: the letter and # of Gloves Sample, from and to", () => {
    const [xs, s, m] = reduceForms(render()).map((form) => /<p data-dialog-description="">([^<]+)<\/p>/.exec(form)?.[1]);
    expect(s).toBe("N → M: # of Gloves Sample 500 → 315");
    expect(xs).toBe("L → K: # of Gloves Sample 200 → 125");
    expect(m).toBe("M → L: # of Gloves Sample 315 → 200");
  });

  it("asks for a reason, required, at most 500 characters, and Reduce waits for one", () => {
    const form = reduceForms(render())[1];
    const reason = /<textarea[^>]*>/.exec(form)?.[0] ?? "";
    expect(form).toMatch(/<label[^>]*for="([^"]+)-reason"[^>]*>Reason<\/label>/);
    expect(reason).toMatch(/id="[^"]+-reason"/);
    expect(reason).toContain('required=""');
    expect(reason).toContain('maxLength="500"');
    expect(reason).toContain('placeholder="e.g. Consistent high-quality factory"');
    // It starts empty at each opening, so Reduce is disabled until a reason is typed.
    expect(form).toMatch(/<textarea[^>]*><\/textarea>/);
    expect(form).toMatch(/<button[^>]*type="submit"[^>]*disabled=""[^>]*>Reduce<\/button>/);
  });

  it("cancels without writing: Cancel only closes the dialog, and Reduce is the form's one submit", () => {
    const form = reduceForms(render())[1];
    expect(form).toMatch(/<div data-dialog-close=""><button[^>]*type="button"[^>]*>Cancel<\/button><\/div>/);
    expect(form.match(/type="submit"/g)).toHaveLength(1);
  });

  it("offers nothing to reduce on a read-only inspection", () => {
    expect(reduceForms(render(true))).toEqual([]);
  });
});
