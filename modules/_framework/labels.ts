// Labels in the template's wording (BUILD_SPEC 4.2 rules 3 and 4). A label
// key is a canonical key ("indicativeWeight", "thin_spot") or a dotted path
// for an entry that needs its own wording in one place, such as a defect in
// one class: STD_EG has "Defective bead" under major and "Defective beads"
// under minor, `major.bead_defective` and `minor.bead_defective`.
import type { ResolvedModule } from "@/lib/schemas/template";
import type { ModuleDefinition } from "./contract";

export type Labels = Readonly<Record<string, string>>;

/**
 * The label for a key, most specific first: labelFor(labels, "minor",
 * "bead_defective") reads `minor.bead_defective`, then `bead_defective`, and
 * shows the key itself when neither is set, never "undefined".
 */
export function labelFor(labels: Labels, ...path: readonly string[]): string {
  for (let start = 0; start < path.length; start += 1) {
    const label = labels[path.slice(start).join(".")];
    if (label !== undefined && label.trim() !== "") return label;
  }
  return path.at(-1) ?? "";
}

/**
 * The template's labels over the module's defaults. A resolved template keeps
 * the labels of the day it was saved; a label key the module added later
 * shows its default instead of nothing. Saved wording always wins.
 */
export function effectiveLabels(
  definition: Pick<ModuleDefinition, "labels">,
  resolved: Pick<ResolvedModule, "labels">,
): Labels {
  return { ...definition.labels, ...resolved.labels };
}
