// The seed templates of lib/coverage (BUILD_SPEC 11), cut down to the
// modules of this group (the others keep their own tests), resolved down
// their extends chain against the app's modules (docs/MODULES.md section 12).
import { seedModuleConfigs, TEMPLATE_CODES, TEMPLATES, type TemplateCode } from "@/lib/coverage";
import type { ResolvedTemplate } from "@/lib/schemas";
import { lookupFrom, resolveTemplateOrThrow } from "@/lib/templates";
import { MODULE_REGISTRY } from "@/modules/registry";

const KEYS: readonly string[] = ["order_lots", "sampling_plan", "carton_sampling"];

function seedDefinition(code: TemplateCode) {
  const spec = TEMPLATES[code];
  return {
    code,
    name: spec.name,
    ...(spec.extends === null ? {} : { extends: spec.extends }),
    scope: { productType: spec.scope.productType, standard: spec.scope.standard },
    unit: spec.unit,
    sizes: spec.sizes.map((size) => ({ value: size.value })),
    // order_lots is listed for the sizes it gives, with its own defaults.
    modules: seedModuleConfigs(code)
      .filter((entry) => KEYS.includes(entry.key))
      .map((entry) => (entry.key === "order_lots" ? { key: entry.key, include: true } : entry)),
  };
}

export function resolveSeed(code: TemplateCode): ResolvedTemplate {
  const bases = TEMPLATE_CODES.map((at) => ({ definition: seedDefinition(at), version: 1 }));
  return resolveTemplateOrThrow(seedDefinition(code), { getBase: lookupFrom(bases), registry: MODULE_REGISTRY });
}
