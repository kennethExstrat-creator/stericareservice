// The sampling plan's labels as this inspection shows them
// (ModuleDefinition.shownLabels). The Sampling Quantity's rows are worded as
// Kenneth wants them on every inspection (27 October 2026): # of Case, Inner
// Box Taken per Case, Total # of Inner Box, # of Gloves, Gloves Taken per
// Inner Box and Put Back. There is one standard flow now, so the wording a
// template version stored for them ("Case", "Inner Box" and "Gloves" on
// STD_EG version 6, "Inner Pack" on SAFEDON_EG) gives way to these on the
// capture screen, in every message, the review and the export, with nothing
// published. Every other label stays the template's.
import type { Labels } from "@/modules/_framework";
import { SAMPLING_QUANTITY_LABELS } from "./config";

export function samplingLabels(labels: Labels): Labels {
  return { ...labels, ...SAMPLING_QUANTITY_LABELS };
}
