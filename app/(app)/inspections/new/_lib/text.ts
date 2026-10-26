// Wording shared by the new-inspection form's parts. Plain functions, so the
// tests read them without rendering.
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
