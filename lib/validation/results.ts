// Module results (BUILD_SPEC 4.2 rule 7) and the two framework rules that
// shape them for every module, whatever its calc returns:
//   6.2.4 sizes not in order_lots appear in no result;
//   6.2.5 a module with missing data is "Not done", never "Passed".
import type { ModuleResult, ModuleStatus, PerSizeResult } from "@/lib/schemas/module-result";
import { normaliseSize } from "@/lib/sizes";

/** Worst first when combining: fail > not_done > warn > pass > info. */
export const STATUS_SEVERITY: Readonly<Record<ModuleStatus, number>> = {
  info: 0,
  pass: 1,
  warn: 2,
  not_done: 3,
  fail: 4,
};

/** The worst of several statuses; `empty` (not done) when there are none, never a pass on nothing. */
export function worstStatus(statuses: Iterable<ModuleStatus>, empty: ModuleStatus = "not_done"): ModuleStatus {
  let worst: ModuleStatus | null = null;
  for (const status of statuses) {
    if (worst === null || STATUS_SEVERITY[status] > STATUS_SEVERITY[worst]) worst = status;
  }
  return worst ?? empty;
}

export function notDone(summary = "Not done."): ModuleResult {
  return { status: "not_done", summary };
}

/** One result per size, in the order given (the context's ordered sizes). */
export function perSizeResults(
  sizes: readonly string[],
  resultFor: (size: string) => PerSizeResult,
): Record<string, PerSizeResult> {
  return Object.fromEntries(sizes.map((size) => [size, resultFor(size)]));
}

/** The module status from its sizes: the worst one; not done when there are no sizes. */
export function combinePerSize(perSize: Readonly<Record<string, PerSizeResult>>): ModuleStatus {
  return worstStatus(Object.values(perSize).map((result) => result.status));
}

/**
 * A per-size module's result: the worst size's status, the summary and the
 * sizes themselves. Leave `perSize` out and the framework counts every
 * ordered size as not done.
 */
export function resultFromSizes(perSize: Readonly<Record<string, PerSizeResult>>, summary: string): ModuleResult {
  return { status: combinePerSize(perSize), summary, perSize: { ...perSize } };
}

export const NO_DATA_SUMMARY = "Not done.";
export const NO_SIZES_SUMMARY = "No sizes ordered yet.";

export type ResultRules = {
  /** The module keeps data per size (ModuleDefinition.perSize). */
  perSize: boolean;
  /** Ordered sizes, canonical, from the context. */
  sizes: readonly string[];
  /** Anything is saved for the module. */
  hasData: boolean;
};

/**
 * Applies 6.2.4 and 6.2.5 to a calc's result:
 * - nothing saved: not done, whatever calc said;
 * - per-size results only for ordered sizes; a per-size module gets "not
 *   done" for every ordered size it left out, and is not done itself while
 *   no size is ordered;
 * - the module status is never better than its worst size.
 */
export function enforceResultRules(result: ModuleResult, { perSize, sizes, hasData }: ResultRules): ModuleResult {
  if (!hasData) {
    const summary = result.status === "not_done" && result.summary.trim() !== "" ? result.summary : NO_DATA_SUMMARY;
    return perSize || result.perSize
      ? { status: "not_done", summary, perSize: perSizeResults(sizes, () => ({ status: "not_done" })) }
      : { status: "not_done", summary };
  }
  if (perSize && sizes.length === 0) return { status: "not_done", summary: NO_SIZES_SUMMARY, perSize: {} };
  if (!perSize && !result.perSize) return result;

  const given = byCanonicalSize(result.perSize ?? {});
  const bySize = perSizeResults(sizes, (size) => given.get(size) ?? { status: "not_done", summary: "No result." });
  const shown = perSize ? bySize : Object.fromEntries(Object.entries(bySize).filter(([size]) => given.has(size)));

  const worst = worstStatus([result.status, ...Object.values(shown).map((entry) => entry.status)]);
  if (worst === result.status) return { ...result, perSize: shown };
  const affected = Object.entries(shown)
    .filter(([, entry]) => entry.status === worst)
    .map(([size]) => size);
  return { status: worst, summary: `${ESCALATION[worst]} for size ${affected.join(", ")}.`, perSize: shown };
}

const ESCALATION: Readonly<Record<ModuleStatus, string>> = {
  fail: "Failed",
  not_done: "Not done",
  warn: "Warning",
  pass: "Passed",
  info: "Info",
};

function byCanonicalSize(perSize: Readonly<Record<string, PerSizeResult>>): Map<string, PerSizeResult> {
  const map = new Map<string, PerSizeResult>();
  for (const [size, entry] of Object.entries(perSize)) {
    const canonical = normaliseSize(size);
    // An exact canonical key wins over a variant spelling of the same size.
    if (canonical !== null && (!map.has(canonical) || size === canonical)) map.set(canonical, entry);
  }
  return map;
}
