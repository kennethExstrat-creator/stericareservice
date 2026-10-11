// Source Documents across PO parts (docs/AI.md, "Source Documents";
// lib/inspections/parts.ts): one set of files for the whole inspection, kept
// on its first part and read once. The AI answers per part, by id, and lists
// the POs no part has yet; this file routes that answer to the parts and
// says what happened to each, for the file's reading (inspection_files
// ai_summary). Pure and client-safe.
import { readModuleEntry, type InspectionData } from "@/modules/_framework/data";
import { fillEmpty, isEmptyValue, type SourceProposals } from "./source-documents";

/** The most POs one reading adds: a stray answer never fills the inspection with parts. */
export const MAX_NEW_PARTS = 10;

/** inspection_files.ai_summary holds at most this many characters. */
export const SUMMARY_MAX = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What tells a part's forms from the others': its PO, lots and sizes, as entered. */
export type PartFacts = { poNo: string | null; lots: string[]; sizes: string[] };

export function partFacts(data: InspectionData): PartFacts {
  const header = readModuleEntry(data, "modules", "header").value;
  const po = isRecord(header) && typeof header.poNo === "string" ? header.poNo.trim() : "";
  const order = readModuleEntry(data, "modules", "order_lots").value;
  const lines = isRecord(order) && isRecord(order.sizes) ? order.sizes : {};
  const lots: string[] = [];
  const sizes: string[] = [];
  for (const [size, line] of Object.entries(lines)) {
    if (!isRecord(line)) continue;
    const own = (Array.isArray(line.lotNumbers) ? line.lotNumbers : [])
      .filter((lot): lot is string => typeof lot === "string")
      .map((lot) => lot.trim())
      .filter(Boolean);
    for (const lot of own) if (!lots.includes(lot)) lots.push(lot);
    // Ordered (a quantity), or at least given a lot.
    if ((typeof line.qtyCases === "number" && line.qtyCases > 0) || own.length > 0) sizes.push(size);
  }
  return { poNo: po || null, lots, sizes };
}

/**
 * A PO number to compare by: the PO before the SO in brackets, letters and
 * digits only, without a leading "PO" ("PO-2680276 (5400053153)" and
 * "2680276" are the same PO). Null when there is none.
 */
export function poKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.split("(")[0].toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.replace(/^PO(?=\d)/, "") || null;
}

/** `a` with what `b` adds where `a` holds nothing, module by module: two forms of one PO (one size each). */
export function mergeProposals(a: SourceProposals, b: SourceProposals): SourceProposals {
  const merged: SourceProposals = { ...a };
  for (const [key, value] of Object.entries(b)) {
    const current = merged[key];
    const next = current === undefined ? value : fillEmpty(current, value);
    if (isRecord(next)) merged[key] = next;
  }
  return merged;
}

function hasProposals(proposals: SourceProposals | undefined): proposals is SourceProposals {
  return proposals !== undefined && Object.values(proposals).some((value) => !isEmptyValue(value));
}

/** The proposals with the PO in the header, where they give none. */
function withPo(proposals: SourceProposals, poNo: string): SourceProposals {
  const header = proposals.header ?? {};
  return typeof header.poNo === "string" && header.poNo.trim() ? proposals : { ...proposals, header: { ...header, poNo } };
}

/** A reading as the AI answered it (lib/ai/source-reader.ts parseSourceAnswer). */
export type SourceAnswerParts = {
  /** By part id, as the AI named them. */
  parts: Record<string, SourceProposals>;
  /** POs the documents hold that no part has: one entry per PO. */
  newParts: readonly { poNo: string; proposals: SourceProposals }[];
  /** The one-inspection answer (`{"modules": …}`): the reading part's. */
  modules?: SourceProposals;
};

/** A part as routing needs it. Only an editable part takes a PO it has not got. */
export type RoutingPart = { id: string; poNo: string | null; editable: boolean };

export type ReadingRoute = {
  /** What to fill into each existing part, by id. */
  byPart: Record<string, SourceProposals>;
  /** POs to add as parts, in the documents' order, with what to fill into each. */
  create: { poNo: string; proposals: SourceProposals }[];
  /** POs left out over MAX_NEW_PARTS. */
  dropped: number;
};

/**
 * Where each form of a reading goes. The AI names the part of each form;
 * here its answer is held to the rules once more: only parts that exist (a
 * part named by its label or PO instead of its id is that part), a "new" PO
 * a part already has goes to that part, a PO listed twice is one part, and
 * a part without a PO takes the first PO no part has.
 */
export function routeReading(
  answer: SourceAnswerParts,
  parts: readonly RoutingPart[],
  readingPartId: string,
  maxNew: number = MAX_NEW_PARTS,
): ReadingRoute {
  const known = new Set(parts.map((part) => part.id));
  const byPo = new Map<string, string>();
  for (const part of parts) {
    const key = poKey(part.poNo);
    if (key && !byPo.has(key)) byPo.set(key, part.id);
  }
  const byPart: Record<string, SourceProposals> = {};
  const add = (id: string, proposals: SourceProposals) => {
    byPart[id] = byPart[id] ? mergeProposals(byPart[id], proposals) : proposals;
  };
  for (const [name, proposals] of Object.entries(answer.parts)) {
    const id = known.has(name) ? name : byPo.get(poKey(name) ?? "");
    if (id && hasProposals(proposals)) add(id, proposals);
  }
  if (hasProposals(answer.modules) && !byPart[readingPartId] && known.has(readingPartId)) add(readingPartId, answer.modules);
  // A part without a PO given one now has it: the same PO listed as new is that part's too.
  for (const part of parts) {
    const proposed = byPart[part.id]?.header?.poNo;
    const key = poKey(part.poNo) === null && typeof proposed === "string" ? poKey(proposed) : null;
    if (key && !byPo.has(key)) byPo.set(key, part.id);
  }

  const create: { key: string; poNo: string; proposals: SourceProposals }[] = [];
  for (const entry of answer.newParts) {
    const key = poKey(entry.poNo);
    if (!key || !hasProposals(entry.proposals)) continue;
    const existing = byPo.get(key);
    if (existing) {
      add(existing, entry.proposals);
      continue;
    }
    const queued = create.find((item) => item.key === key);
    if (queued) {
      queued.proposals = mergeProposals(queued.proposals, entry.proposals);
      continue;
    }
    const open = parts.find((part) => part.editable && poKey(part.poNo) === null && !byPart[part.id]);
    if (open) {
      add(open.id, withPo(entry.proposals, entry.poNo));
      byPo.set(key, open.id);
      continue;
    }
    create.push({ key, poNo: entry.poNo, proposals: entry.proposals });
  }
  return {
    byPart,
    create: create.slice(0, maxNew).map(({ poNo, proposals }) => ({ poNo, proposals })),
    dropped: Math.max(0, create.length - maxNew),
  };
}

/** What a reading did to one part, for the file's summary. */
export type PartOutcome =
  /** An existing part: filled on the server, or by the screen that read the file. */
  | { kind: "filled"; label: string; filled: number }
  /** A new part; `problem`: why nothing was filled into it, as the end of a sentence. */
  | { kind: "added"; label: string; filled: number; problem?: string }
  /** An existing part that was left as it was: why, as the end of a sentence. */
  | { kind: "skipped"; label: string; reason: string }
  /** A PO that could not be added: createPart's message. */
  | { kind: "not_added"; label: string; message: string };

function fields(count: number): string {
  return `${count} ${count === 1 ? "field" : "fields"}`;
}

/** "Filled 12 fields in PO 2680276. Added PO 2680280 with 9 fields. Skipped PO 2680279: it is submitted." */
export function describeOutcomes(outcomes: readonly PartOutcome[], dropped = 0): string {
  const lines = outcomes.map((outcome) => {
    switch (outcome.kind) {
      case "filled":
        return outcome.filled > 0 ? `Filled ${fields(outcome.filled)} in ${outcome.label}.` : `Nothing new for ${outcome.label}.`;
      case "added":
        if (outcome.problem) return `Added ${outcome.label}, but nothing was filled in: ${outcome.problem}.`;
        return outcome.filled > 0 ? `Added ${outcome.label} with ${fields(outcome.filled)}.` : `Added ${outcome.label}.`;
      case "skipped":
        return `Skipped ${outcome.label}: ${outcome.reason}.`;
      case "not_added":
        return `${outcome.label} was not added: ${outcome.message}`;
    }
  });
  if (dropped > 0) lines.push(`${dropped} more ${dropped === 1 ? "PO was" : "POs were"} left out: add ${dropped === 1 ? "it" : "them"} by hand.`);
  return lines.join(" ");
}

/**
 * What is kept with the file (ai_summary): what the documents are, what
 * happened to each part, then how each shortform was read, for the admin
 * to check. Cut at SUMMARY_MAX, the parts' lines kept before the rest.
 */
export function readingSummary(summary: string, report: string, mappings: readonly string[]): string {
  const readAs = mappings.length > 0 ? `Read as: ${mappings.join("; ")}.` : "";
  const text = [summary.trim() || "Read.", report.trim(), readAs].filter(Boolean).join(" ");
  if (text.length <= SUMMARY_MAX) return text;
  let cut = text.slice(0, SUMMARY_MAX - 1).trimEnd();
  // Never half a character: Postgres refuses a lone surrogate.
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut}…`;
}
