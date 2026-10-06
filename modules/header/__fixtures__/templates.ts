// The seed templates of lib/coverage (STD_EG, SAFEDON_EG extends STD_EG,
// STD_SG) resolved by lib/templates against the real modules, as a seed
// would save them: each module's config is what the seed writes (the whole
// config for a root template, the diff for a child) merged over the module's
// defaults and validated by its schema. Only the modules named are listed,
// so a test depends on those modules alone.
import { lookupFrom, resolveTemplateOrThrow } from "@/lib/templates";
import { seedModuleConfigs, TEMPLATE_CODES, TEMPLATES, type TemplateCode } from "@/lib/coverage";
import type { ModuleKey } from "@/lib/schemas";
import type { ResolvedModule, ResolvedTemplate } from "@/lib/schemas/template";
import { MODULE_REGISTRY } from "@/modules/registry";

function seedDefinition(code: TemplateCode, keys: readonly ModuleKey[]) {
  const spec = TEMPLATES[code];
  return {
    code: spec.code,
    name: spec.name,
    ...(spec.extends === null ? {} : { extends: spec.extends }),
    scope: { productType: spec.scope.productType, standard: spec.scope.standard },
    unit: spec.unit,
    sizes: spec.sizes.map((size) => ({ ...size })),
    modules: seedModuleConfigs(code).filter((module) => keys.includes(module.key)),
  };
}

export function resolveSeedTemplate(code: TemplateCode, keys: readonly ModuleKey[]): ResolvedTemplate {
  const versions = TEMPLATE_CODES.map((template) => ({ definition: seedDefinition(template, keys), version: 1 }));
  return resolveTemplateOrThrow(seedDefinition(code, keys), { getBase: lookupFrom(versions), registry: MODULE_REGISTRY });
}

export function resolvedModule(template: ResolvedTemplate, key: ModuleKey): ResolvedModule {
  const found = template.modules.find((module) => module.key === key);
  if (!found) throw new Error(`${template.code} has no ${key}`);
  return found;
}
