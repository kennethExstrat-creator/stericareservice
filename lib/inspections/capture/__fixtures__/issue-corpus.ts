// Real issues for the Pending panel's tests: the three seed templates
// (STD_EG, SAFEDON_EG, STD_SG: every one of the 17 modules they use)
// evaluated as the capture screen does, empty, as the example reports fill
// them (tests/acceptance/examples.ts), with each module left out in turn,
// with each module filled alone next to the order, and with one size left
// out; and the capture test template's custom sections, empty and filled.
// So every row the panel can show for these inspections is checked against
// the issues lib/validation really writes, not typed copies of them.
import type { ResolvedTemplate } from "@/lib/schemas/template";
import { MODULE_REGISTRY } from "@/modules/registry";
import type { InspectionData, ModuleRegistry } from "@/modules/_framework";
import { inspectionMeta, safedonEgData, safedonEgFiles, seedTemplate, stdEgData } from "@/tests/acceptance/examples";
import { SAFEDON_EG_EXAMPLE, STD_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { newInspectionData } from "../../create";
import { evaluateCapture, type CaptureMeta } from "../evaluate";
import { groupIssues, pendingTasks, type PendingTask } from "../issues";
import { captureSections } from "../sections";
import { emptyData, filledData, TEST_META, TEST_REGISTRY, testTemplate } from "./capture";

type SeedCode = "STD_EG" | "SAFEDON_EG" | "STD_SG";

export type CorpusCase = {
  /** "SAFEDON_EG full without weight". */
  name: string;
  /** The ordered sizes, in order. */
  sizes: readonly string[];
  tasks: PendingTask[];
};

type Scenario = { name: string; data: InspectionData; meta: CaptureMeta };

function evaluated(name: string, template: ResolvedTemplate, data: InspectionData, meta: CaptureMeta, registry?: ModuleRegistry): CorpusCase {
  const evaluation = evaluateCapture({ template, overrides: {}, data, meta }, registry);
  const sections = captureSections(evaluation.template, evaluation.report, data);
  return {
    name,
    sizes: evaluation.context.sizes,
    tasks: pendingTasks(groupIssues(evaluation.report.issues, sections), sections, evaluation.report.modules),
  };
}

function captureMeta(code: SeedCode, labReport: boolean): CaptureMeta {
  const meta = inspectionMeta(code === "SAFEDON_EG" ? SAFEDON_EG_EXAMPLE : STD_EG_EXAMPLE, code === "SAFEDON_EG" ? safedonEgFiles(labReport) : []);
  return {
    refNo: meta.refNo ?? null,
    inspectionDate: meta.inspectionDate ?? null,
    inspector: meta.inspector ?? null,
    client: meta.client ?? null,
    manufacturer: meta.manufacturer ?? null,
    files: meta.files ?? [],
  };
}

/** The filled inspections each template is checked with. */
function filled(code: SeedCode): Scenario[] {
  switch (code) {
    case "STD_EG":
      return [
        { name: "as entered", data: stdEgData(), meta: captureMeta(code, false) },
        { name: "corrected", data: stdEgData({ corrected: true }), meta: captureMeta(code, false) },
      ];
    case "SAFEDON_EG":
      return [
        { name: "full", data: safedonEgData(), meta: captureMeta(code, true) },
        { name: "full, no lab report", data: safedonEgData({ labReport: false }), meta: captureMeta(code, false) },
      ];
    case "STD_SG":
      // No example report of its own: STD_EG's, which STD_SG reads where its modules overlap.
      return [{ name: "STD_EG's data", data: stdEgData({ corrected: true }), meta: captureMeta(code, false) }];
  }
}

/** Every module's data with one size taken out: that size not done, in every per-size module. */
function withoutSize(data: InspectionData, size: string): InspectionData {
  const modules = Object.fromEntries(
    Object.entries(data.modules).map(([key, value]) => {
      if (key === "order_lots" || typeof value !== "object" || value === null || !("sizes" in value)) return [key, value];
      const sizes = (value as { sizes: unknown }).sizes;
      if (typeof sizes !== "object" || sizes === null) return [key, value];
      const rest = Object.fromEntries(Object.entries(sizes).filter(([name]) => name !== size));
      return [key, { ...value, sizes: rest }];
    }),
  );
  return { ...data, modules };
}

export function issueCorpus(): CorpusCase[] {
  const cases: CorpusCase[] = [];
  for (const code of ["STD_EG", "SAFEDON_EG", "STD_SG"] as const) {
    const template = seedTemplate(code);
    const empty = newInspectionData({ template, registry: MODULE_REGISTRY, inspectionDate: "2026-10-06", productName: null }).data;
    cases.push(evaluated(`${code} empty`, template, empty, captureMeta(code, false)));
    for (const scenario of filled(code)) {
      const run = (name: string, data: InspectionData) => cases.push(evaluated(`${code} ${scenario.name} ${name}`.trim(), template, data, scenario.meta));
      run("", scenario.data);
      for (const key of Object.keys(scenario.data.modules)) {
        const rest = Object.fromEntries(Object.entries(scenario.data.modules).filter(([other]) => other !== key));
        run(`without ${key}`, { ...scenario.data, modules: rest });
        run(`only order and ${key}`, { modules: { order_lots: scenario.data.modules.order_lots, [key]: scenario.data.modules[key] }, custom: {} });
      }
      run("without size XS", withoutSize(scenario.data, "XS"));
      run("without size M", withoutSize(scenario.data, "M"));
    }
  }
  // Custom sections (fields and a grid) on the capture test template.
  cases.push(evaluated("test template empty", testTemplate(), emptyData(), TEST_META, TEST_REGISTRY));
  cases.push(evaluated("test template filled", testTemplate(), filledData(), TEST_META, TEST_REGISTRY));
  return cases;
}
