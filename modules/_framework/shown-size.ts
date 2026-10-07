"use client";

// The size on screen, reported for photo tags (BUILD_SPEC 8.1; docs/MODULES.md
// 10 and 10.1). A per-size Capture that shows one size reports it as it
// mounts and whenever it changes, so a photo taken straight after a section
// opens, or after an issue link turned the size, is tagged with the size the
// section shows. While every size sits side by side (from 1280 px with
// SizeTabs' wide="all") no size is on screen alone and none is reported: a
// photo then carries what a focused field reports. For Capture.tsx only,
// imported by this path, as the file slot is.
import { useEffectEvent, useLayoutEffect } from "react";
import { useMediaQuery, useSizeTabsLayout, WIDE_QUERY } from "@/components/qc";
import type { CaptureFocus } from "./contract";

type ReportFocus = ((focus: CaptureFocus) => void) | undefined;

/**
 * Reports `{ size }` for `size`, the one size on screen, as the Capture
 * mounts and whenever it changes; nothing while it is null or empty (no size
 * ordered, or every size side by side). A layout effect, so it always comes
 * first: an issue link that turns to another size focuses its field a frame
 * later, and that field's own report (its box, its defect) must follow this
 * one, never be replaced by it.
 */
export function useReportShownSize(size: string | null, onFocusChange: ReportFocus): void {
  const report = useEffectEvent((shown: string) => onFocusChange?.({ size: shown }));
  useLayoutEffect(() => {
    if (size) report(size);
  }, [size]);
}

/**
 * The size SizeTabs shows for a module's `value`: `value` while it is
 * ordered, else the first size ordered ("" with none), as SizeTabs corrects
 * a size taken out of the order.
 */
export function sizeOnTabs(sizes: readonly string[], value: string): string {
  return sizes.includes(value) ? value : (sizes[0] ?? "");
}

/**
 * `size` while it is the only size on screen: one size is ordered, or the
 * sizes do not sit side by side (a touchscreen, below 1280 px, or SizeTabs
 * keeping its tabs because a table does not fit); null while every size does.
 */
export function sizeShownAlone(sizes: readonly string[], size: string, sideBySide: boolean): string | null {
  return sizes.length === 1 || !sideBySide ? size : null;
}

/**
 * For SizeTabs with wide="all" and a per-size function panel, where every
 * size sits side by side from 1280 px: the size on the tabs for `value`
 * while it is the only one on screen. Until the client knows the screen
 * (hydration) it counts as wide, so a size that may not be the only one
 * shown is never reported.
 */
export function useSizeShownAlone(sizes: readonly string[], value: string): string | null {
  return sizeShownAlone(sizes, sizeOnTabs(sizes, value), useMediaQuery(WIDE_QUERY, true));
}

/**
 * The report for SizeTabs with wide="all" and a node panel (CounterTables
 * given `activeColumn`), rendered inside that panel: there SizeTabs keeps its
 * tabs from 1280 px while a table does not fit side by side, and says so.
 * Reports the size on the tabs while it is the only one on screen.
 */
export function ShownSizeReport({ sizes, onFocusChange }: { sizes: readonly string[]; onFocusChange: ReportFocus }): null {
  const layout = useSizeTabsLayout();
  const wide = useMediaQuery(WIDE_QUERY, true);
  const size = layout === null ? null : sizeShownAlone(sizes, layout.size, wide && layout.sideBySide);
  useReportShownSize(size, onFocusChange);
  return null;
}
