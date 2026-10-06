// Pure edits behind Capture.tsx: each takes the module's whole data and
// returns the whole new value for onChange, leaving every other size as it
// was, ordered or not (MODULES.md section 10).
import type { Hand } from "@/modules/_framework";
import type { HoleLocation } from "./config";
import {
  emptyWatertightHand,
  emptyWatertightSize,
  type OneOffDefect,
  type WatertightData,
  type WatertightHand,
  type WatertightSize,
} from "./schema";

/** Where a count goes: a size, and a hand when the template splits hands. */
export type HoleCell = { size: string; hand?: Hand };

/** CounterTable row keys of one-off labels; defect codes never contain a colon. */
export const ONE_OFF_ROW_PREFIX = "unmapped:";

/** One-off labels compare without case or extra spaces: "near thumb" is "Near  thumb". */
export function labelKey(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

export function oneOffRowKey(label: string): string {
  return `${ONE_OFF_ROW_PREFIX}${labelKey(label)}`;
}

function sizeOf(data: WatertightData, size: string): WatertightSize {
  return data.sizes[size] ?? emptyWatertightSize();
}

function handOf(entry: WatertightSize, hand: Hand | undefined): WatertightHand {
  return hand === undefined ? entry : (entry[hand] ?? emptyWatertightHand());
}

function withSize(data: WatertightData, size: string, entry: WatertightSize): WatertightData {
  return { ...data, sizes: { ...data.sizes, [size]: entry } };
}

function withHand(data: WatertightData, { size, hand }: HoleCell, change: (record: WatertightHand) => WatertightHand): WatertightData {
  const entry = sizeOf(data, size);
  if (hand === undefined) {
    const { holes, otherDescription, unmapped } = change(entry);
    return withSize(data, size, { ...entry, holes, otherDescription, unmapped });
  }
  return withSize(data, size, { ...entry, [hand]: change(handOf(entry, hand)) });
}

export function readHoles(data: WatertightData, { size, hand }: HoleCell, code: string): number {
  return handOf(sizeOf(data, size), hand).holes[code] ?? 0;
}

/** A location's count; 0 removes the key, since a location never tapped has no holes. */
export function setHoles(data: WatertightData, cell: HoleCell, code: string, count: number): WatertightData {
  return withHand(data, cell, (record) => {
    const holes = { ...record.holes };
    if (count > 0) holes[code] = count;
    else delete holes[code];
    return { ...record, holes };
  });
}

export function setTested(data: WatertightData, size: string, tested: number | null): WatertightData {
  return withSize(data, size, { ...sizeOf(data, size), tested });
}

export function setOtherDescription(data: WatertightData, cell: HoleCell, text: string): WatertightData {
  return withHand(data, cell, (record) => ({ ...record, otherDescription: text.trim() === "" ? null : text }));
}

export function readOneOff(data: WatertightData, cell: HoleCell, label: string): { index: number; entry: OneOffDefect } | null {
  const key = labelKey(label);
  const list = handOf(sizeOf(data, cell.size), cell.hand).unmapped;
  const index = list.findIndex((entry) => labelKey(entry.label) === key);
  return index === -1 ? null : { index, entry: list[index] };
}

/** A one-off's count in one cell, added to that cell's list when it is not there yet. */
export function setOneOff(data: WatertightData, cell: HoleCell, label: string, count: number): WatertightData {
  return withHand(data, cell, (record) => {
    const key = labelKey(label);
    const index = record.unmapped.findIndex((entry) => labelKey(entry.label) === key);
    const unmapped =
      index === -1
        ? [...record.unmapped, { label: label.trim(), count }]
        : record.unmapped.map((entry, at) => (at === index ? { ...entry, count } : entry));
    return { ...record, unmapped };
  });
}

/**
 * Adds a one-off label (count 0) to a cell so its row appears; the inspector
 * then counts it like any other row. Nothing changes when the label is
 * already a listed location or a one-off row: that row is used instead.
 */
export function addOneOff(
  data: WatertightData,
  cell: HoleCell,
  label: string,
  locations: readonly HoleLocation[],
  sizes: readonly string[],
  split: boolean,
): WatertightData {
  const key = labelKey(label);
  if (key === "") return data;
  if (locations.some((location) => labelKey(location.label.replace(/\s*:\s*$/, "")) === key || labelKey(location.label) === key)) {
    return data;
  }
  if (oneOffLabels(data, sizes, split).some((existing) => labelKey(existing) === key)) return data;
  return setOneOff(data, cell, label, 0);
}

/**
 * Codes with holes saved that the template's list lacks, over the ordered
 * sizes (and hands): calc counts them, so the screen shows them as rows too.
 */
export function unlistedCodes(
  data: WatertightData,
  sizes: readonly string[],
  split: boolean,
  listed: ReadonlySet<string>,
): string[] {
  const codes = new Set<string>();
  for (const size of sizes) {
    const entry = data.sizes[size];
    if (!entry) continue;
    for (const record of split ? [entry.R, entry.L] : [entry]) {
      for (const [code, count] of Object.entries(record?.holes ?? {})) {
        if (count > 0 && !listed.has(code)) codes.add(code);
      }
    }
  }
  return [...codes];
}

/** The one-off labels saved for any ordered size (and hand), first spelling kept, in order of entry. */
export function oneOffLabels(data: WatertightData, sizes: readonly string[], split: boolean): string[] {
  const seen = new Map<string, string>();
  for (const size of sizes) {
    const entry = data.sizes[size];
    if (!entry) continue;
    const records = split ? [entry.R, entry.L] : [entry];
    for (const record of records) {
      for (const { label } of record?.unmapped ?? []) {
        const key = labelKey(label);
        if (!seen.has(key)) seen.set(key, label.trim());
      }
    }
  }
  return [...seen.values()];
}
