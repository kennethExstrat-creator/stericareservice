// Calculation order. The context is complete before any calc runs, so most
// modules can run in template order. A module that reads other modules'
// results declares them in `dependsOn` and runs after them; the conclusion
// declares "all" and runs last.
import type { ModuleKey, ModuleResult } from "@/lib/schemas/module-result";
import type { ModuleRegistry } from "./contract";

/** Template order, with every module after the modules it depends on. Throws on a loop. */
export function calcOrder(keys: readonly ModuleKey[], registry: ModuleRegistry): ModuleKey[] {
  const present = new Set(keys);
  const state = new Map<ModuleKey, "visiting" | "done">();
  const order: ModuleKey[] = [];

  const visit = (key: ModuleKey, trail: readonly ModuleKey[]) => {
    const seen = state.get(key);
    if (seen === "done") return;
    if (seen === "visiting") throw new Error(`Module dependencies loop: ${[...trail, key].join(" -> ")}`);
    state.set(key, "visiting");
    for (const dependency of dependenciesOf(key, keys, present, registry)) visit(dependency, [...trail, key]);
    state.set(key, "done");
    order.push(key);
  };

  for (const key of keys) visit(key, []);
  return order;
}

/** The included modules `key` waits for: those it names, or every other module for "all". */
export function dependenciesOf(
  key: ModuleKey,
  keys: readonly ModuleKey[],
  present: ReadonlySet<ModuleKey>,
  registry: ModuleRegistry,
): ModuleKey[] {
  const dependsOn = registry[key].dependsOn;
  if (dependsOn === "all") return keys.filter((other) => other !== key && registry[other].dependsOn !== "all");
  return dependsOn.filter((dependency) => dependency !== key && present.has(dependency));
}

/** The results a module may read: those of its dependencies, once computed. */
export function resultsFor(
  key: ModuleKey,
  keys: readonly ModuleKey[],
  results: ReadonlyMap<ModuleKey, ModuleResult>,
  registry: ModuleRegistry,
): Partial<Record<ModuleKey, ModuleResult>> {
  const visible: Partial<Record<ModuleKey, ModuleResult>> = {};
  for (const dependency of dependenciesOf(key, keys, new Set(keys), registry)) {
    const result = results.get(dependency);
    if (result) visible[dependency] = result;
  }
  return visible;
}
