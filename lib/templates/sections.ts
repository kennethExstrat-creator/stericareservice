// Screen and export order: the template's modules, each custom module right
// after the module it names in `after` (BUILD_SPEC 4.3).
import type { ModuleKey } from "@/lib/schemas/module-result";
import type { CustomModule, ResolvedModule, ResolvedTemplate } from "@/lib/schemas/template";

export type TemplateSection =
  | { kind: "module"; key: ModuleKey; module: ResolvedModule }
  | { kind: "custom"; key: string; custom: CustomModule };

/**
 * Included modules and every custom module in order. A custom module stays in
 * place when the module it follows is switched off; one whose module is
 * missing altogether goes last.
 */
export function templateSections(template: ResolvedTemplate): TemplateSection[] {
  const after = new Map<ModuleKey, CustomModule[]>();
  for (const custom of template.customModules) after.set(custom.after, [...(after.get(custom.after) ?? []), custom]);

  const sections: TemplateSection[] = [];
  for (const entry of template.modules) {
    if (entry.include) sections.push({ kind: "module", key: entry.key, module: entry });
    for (const custom of after.get(entry.key) ?? []) sections.push({ kind: "custom", key: custom.key, custom });
    after.delete(entry.key);
  }
  for (const orphans of after.values()) {
    for (const custom of orphans) sections.push({ kind: "custom", key: custom.key, custom });
  }
  return sections;
}

/** Section keys in order: what issue lists and the export sort by. */
export function sectionOrder(template: ResolvedTemplate): string[] {
  return templateSections(template).map((section) => section.key);
}
