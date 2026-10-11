// Where the PO parts bar points and what the capture header says about the
// part on screen (lib/inspections/parts.ts): another part's capture screen,
// open on the page the inspector is on; which part this is ("PO 1000002",
// "Part 2 of 3"); and the browser tab's title. Pure, so the rules are tested
// without a browser.
import { groupRefNo, partLabel, type InspectionPart } from "@/lib/inspections/parts";

/** A part's capture screen, open on the page named by `moduleKey` (?module=) when there is one. */
export function partHref(partId: string, moduleKey: string | null): string {
  const path = `/inspections/${partId}`;
  return moduleKey ? `${path}?${new URLSearchParams({ module: moduleKey })}` : path;
}

export type PartPosition = {
  /** "PO 1000002", or "PO 2" while the part has no PO number. */
  label: string;
  /** "Part 2 of 3". */
  position: string;
  /** The part's own reference number. */
  refNo: string;
  /** The inspection's reference number: the first part's. */
  groupRefNo: string;
};

/** Which part `currentId` is, in an inspection of several POs; null for one PO, or a part not in the list. */
export function partPosition(parts: readonly InspectionPart[], currentId: string): PartPosition | null {
  if (parts.length < 2) return null;
  const index = parts.findIndex((part) => part.id === currentId);
  if (index < 0) return null;
  const part = parts[index];
  return {
    label: partLabel(part, index),
    position: `Part ${index + 1} of ${parts.length}`,
    refNo: part.refNo,
    groupRefNo: groupRefNo(parts) ?? part.refNo,
  };
}

/**
 * The browser tab's title: the inspection's reference number with the part,
 * "INS-2026-0001 · PO 1000002", so the tabs of two parts differ; for one PO
 * (or parts that could not be read) its reference number alone.
 */
export function partTitle(refNo: string, parts: readonly InspectionPart[] | null, currentId: string): string {
  const part = parts ? partPosition(parts, currentId) : null;
  return part ? `${part.groupRefNo} · ${part.label}` : refNo;
}
