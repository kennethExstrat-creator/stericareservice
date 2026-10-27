// The sampling plan for the manufacturer (Kenneth, 27 October 2026; docs/BUILD_SPEC.md section 10): its one A4
// landscape page, its frame and its table, on the report's primitives. Pure markup, no hooks: server-rendered on
// /inspections/[id]/sampling-plan/print.
export { SamplingPlanDocument, SamplingPlanBody, type SamplingPlanDocumentProps } from "./sampling-plan-page";
export { SamplingPlanFrame, type SamplingPlanFrameProps } from "./frame";
export { SamplingPlanTable, columnShares, countText, NO_COUNT, type SamplingPlanTableProps } from "./plan-table";
