// Wording shared by the new-inspection form's parts. Plain functions, so the
// tests read them without rendering.
import type { PreviousProduct } from "@/lib/inspections/create";

/** "STD_EG version 2". */
export function templateLabel(template: { code: string; version: number }): string {
  return `${template.code} version ${template.version}`;
}

/**
 * Specs and AQL live in the template, so "start from previous" keeps them
 * exactly when the inspection uses the template version the last one used.
 */
export function specsNote(
  product: Pick<PreviousProduct, "templateCode" | "templateVersion">,
  template: { code: string; version: number },
): string {
  const last = { code: product.templateCode, version: product.templateVersion };
  if (last.code === template.code && last.version === template.version) {
    return `Same template as last time (${templateLabel(template)}): its specs and AQL carry over.`;
  }
  if (last.code === template.code) {
    return `Last time used version ${last.version}. This inspection uses version ${template.version}, with its specs and AQL.`;
  }
  return `Last time used ${templateLabel(last)}. This inspection uses ${templateLabel(template)}: specs and AQL come from it.`;
}
