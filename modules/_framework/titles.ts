// Titles as this inspection shows them (BUILD_SPEC 6.2 rule 11). A
// template's titles are stored with its version and never change (4.2 rule
// 8), but a module may word its title for the inspection: weight's drops the
// count of gloves it names, as it records one value per size (Kenneth, 26
// October 2026). A module says how through `shownTitle` (ModuleDefinition);
// the framework applies it here, once per evaluation, once the context is
// complete. The capture, review and export pipelines evaluate with
// buildInspectionView, so the step list, every message, the conclusion, the
// review and the export name a module alike.
import type { ModuleKey } from "@/lib/schemas/module-result";
import type { ResolvedModule, ResolvedTemplate } from "@/lib/schemas/template";
import type { ModuleRegistry } from "./contract";
import { buildInspectionContext, type BuildContextInput, type IncludedModule, type InspectionContext } from "./context";

/** The template and the context with the titles this inspection shows. */
export type InspectionView = { template: ResolvedTemplate; context: InspectionContext };

/**
 * The context built from the inspection's data (buildInspectionContext), then
 * the titles as the inspection shows them, on the template and in the
 * context (withShownTitles): what the capture screen, submit, the review and
 * the export evaluate with.
 */
export function buildInspectionView(input: BuildContextInput, registry: ModuleRegistry): InspectionView {
  return withShownTitles(input.template, buildInspectionContext(input, registry), registry);
}

/**
 * Every module's title as this inspection shows it, included or switched
 * off: its `shownTitle` over the stored title, given its parsed config and
 * the complete context. The stored title stays where the config does not
 * parse, or the hook throws or answers blank. The template comes back as a
 * copy with the new titles, and the context with the same titles in
 * `modules`. Only the entries that change are copied, so every config keeps
 * its reference; when nothing changes, the very same objects come back.
 */
export function withShownTitles(
  template: ResolvedTemplate,
  context: InspectionContext,
  registry: ModuleRegistry,
): InspectionView {
  const shown = new Map<ModuleKey, string>();
  for (const entry of template.modules) {
    const title = shownTitleOf(entry, context, registry);
    if (title !== entry.title) shown.set(entry.key, title);
  }
  if (shown.size === 0) return { template, context };
  const modules = context.modules ? retitled(context.modules, shown) : undefined;
  return {
    template: { ...template, modules: retitled(template.modules, shown) },
    context: modules && modules !== context.modules ? { ...context, modules } : context,
  };
}

function shownTitleOf(entry: ResolvedModule, context: InspectionContext, registry: ModuleRegistry): string {
  const definition = registry[entry.key];
  if (!definition?.shownTitle) return entry.title;
  try {
    // Module code runs in the schema's refinements too.
    const config = definition.configSchema.safeParse(entry.config);
    if (!config.success) return entry.title;
    const title: unknown = definition.shownTitle({ title: entry.title, config: config.data, context });
    return typeof title === "string" && title.trim() !== "" ? title : entry.title;
  } catch {
    return entry.title;
  }
}

/** The list with the new titles; the same list when none of its entries changes. */
function retitled<T extends ResolvedModule | IncludedModule>(entries: readonly T[], shown: ReadonlyMap<ModuleKey, string>): T[] {
  let changed = false;
  const next = entries.map((entry) => {
    const title = shown.get(entry.key);
    if (title === undefined || title === entry.title) return entry;
    changed = true;
    return { ...entry, title };
  });
  return changed ? next : (entries as T[]);
}
