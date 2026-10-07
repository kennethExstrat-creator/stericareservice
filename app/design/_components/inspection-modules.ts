// The STD_EG module list (BUILD_SPEC 11) with sample progress, shared by the
// progress and layout demos.
import type { ProgressStep } from "@/components/qc";

export const MODULE_STEPS: ProgressStep[] = [
  { key: "header", label: "Manufacturer Information", state: "done", result: "info" },
  { key: "glove_info", label: "Glove Information", state: "done", result: "info" },
  { key: "order_lots", label: "Order", state: "done", result: "info" },
  { key: "packing_config", label: "Packing Configuration", state: "done", result: "warn" },
  { key: "sampling_plan", label: "Sampling Plan", state: "done", result: "pass" },
  { key: "carton_sampling", label: "Carton Numbers", state: "done", result: "pass" },
  { key: "dimensions", label: "Dimension", state: "in_progress", result: "not_done" },
  { key: "force_at_break", label: "Force at Break", state: "not_started", result: "not_done" },
  { key: "weight", label: "Weight (g)", state: "not_started", result: "not_done" },
  { key: "watertight", label: "Freedom From Holes", state: "not_started", result: "not_done" },
  { key: "visual", label: "Visual Inspection", state: "not_started", result: "not_done" },
  { key: "dispensing_packing", label: "Glove Packing Check", state: "not_started", result: "not_done" },
  { key: "labeling", label: "Packaging Labeling Inspection", state: "not_started", result: "not_done" },
  { key: "conclusion", label: "Conclusion", state: "not_started", result: "not_done" },
];
