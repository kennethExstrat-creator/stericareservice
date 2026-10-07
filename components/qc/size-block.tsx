"use client";

// Per-size content beside a CounterTable in SizeTabs' node panel (the gloves
// tested above a table of holes): it follows the tabs the way the table does,
// one size below 1280 px, and every size from 1280 px only while SizeTabs
// shows them side by side (it keeps its tabs where a table does not fit, such
// as a hand split over many sizes).
import { useContext, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { SizeTabsContext } from "./size-tabs-context";

/** The size SizeTabs shows, and whether every size sits side by side from 1280 px. */
export type SizeTabsLayout = { readonly size: string; readonly sideBySide: boolean };

/**
 * The layout of the SizeTabs around this component, in its node panel; null
 * outside SizeTabs, or in a per-size function panel (one size already).
 */
export function useSizeTabsLayout(): SizeTabsLayout | null {
  const state = useContext(SizeTabsContext);
  return state ? { size: state.size, sideBySide: state.sideBySide } : null;
}

/**
 * A size's own block: shown for the size on the tabs, and for every size
 * from 1280 px while the sizes sit side by side. Outside SizeTabs it is
 * always shown.
 */
export function SizeBlock({ size, className, ...props }: ComponentProps<"div"> & { size: string }) {
  const layout = useSizeTabsLayout();
  const elsewhere = layout !== null && layout.size !== size;
  return (
    <div
      data-slot="size-block"
      data-size={size}
      className={cn(className, elsewhere && (layout.sideBySide ? "max-xl:hidden" : "hidden"))}
      {...props}
    />
  );
}

/**
 * Words that tell the sizes apart, such as ", Size XS" in a field's label:
 * always read out, and shown from 1280 px where the sizes sit side by side.
 */
export function SideBySideText({ className, ...props }: ComponentProps<"span">) {
  const layout = useSizeTabsLayout();
  return <span className={cn("sr-only", layout?.sideBySide && "xl:not-sr-only", className)} {...props} />;
}
