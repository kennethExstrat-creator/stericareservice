// The sampling plan for the manufacturer (Kenneth, 27 October 2026; docs/BUILD_SPEC.md section 10): the export
// turned into the model of its one A4 landscape page, the print route's paths and when the plan may go. Pure and
// client-safe.
export {
  buildSamplingPlanModel,
  oddOnesOut,
  productKind,
  samplingPlanFileName,
  GLANCE_TITLE,
  ORDER_TITLE,
  PLAN_TABLE_TITLE,
  SAMPLING_PLAN_FOOTER,
  SAMPLING_PLAN_LEAD,
  SAMPLING_PLAN_TITLE,
  type GlanceLine,
  type SamplingPlanCell,
  type SamplingPlanChrome,
  type SamplingPlanFact,
  type SamplingPlanGroup,
  type SamplingPlanModel,
  type SamplingPlanOrder,
  type SamplingPlanOrderLine,
  type SamplingPlanRow,
  type SamplingPlanRowKey,
  type SamplingPlanSize,
  type UnitWords,
} from "./model";
export { samplingPlanPrintPath, samplingPlanReady, samplingPlanStepPath } from "./paths";
