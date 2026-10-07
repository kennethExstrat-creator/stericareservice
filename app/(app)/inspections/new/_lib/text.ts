// Wording shared by the new-inspection form's parts. Plain functions, so the
// tests read them without rendering.
import type { PreviousProduct } from "@/lib/inspections/create";
import type { TemplateOption } from "./types";

type TemplateVersion = { code: string; version: number };

/**
 * "STD_EG Version 2": a template version where a label names it, on the chosen
 * template and in the admin's picker. Title Case, as the admin's template
 * pages name it (docs/DESIGN.md, Capitalisation).
 */
export function templateLabel(template: TemplateVersion): string {
  return `${template.code} Version ${template.version}`;
}

/** "STD_EG version 2": the same within a sentence, which keeps its own case. */
export function templateInSentence(template: TemplateVersion): string {
  return `${template.code} version ${template.version}`;
}

/**
 * Another template in the admin's picker: "STD_EG Version 2 · Draft", and
 * "· Cannot Be Used Yet" while its resolution does not read.
 */
export function overrideOptionLabel(template: Pick<TemplateOption, "code" | "version" | "status" | "ready">): string {
  return [templateLabel(template), template.status === "draft" ? "Draft" : null, template.ready ? null : "Cannot Be Used Yet"]
    .filter((part) => part !== null)
    .join(" · ");
}

/**
 * Specs and AQL live in the template, so "start from previous" keeps them
 * exactly when the inspection uses the template version the last one used.
 */
export function specsNote(
  product: Pick<PreviousProduct, "templateCode" | "templateVersion">,
  template: TemplateVersion,
): string {
  const last = { code: product.templateCode, version: product.templateVersion };
  if (last.code === template.code && last.version === template.version) {
    return `Same template as last time (${templateInSentence(template)}): its specs and AQL carry over.`;
  }
  if (last.code === template.code) {
    return `Last time used version ${last.version}. This inspection uses version ${template.version}, with its specs and AQL.`;
  }
  return `Last time used ${templateInSentence(last)}. This inspection uses ${templateInSentence(template)}: specs and AQL come from it.`;
}
