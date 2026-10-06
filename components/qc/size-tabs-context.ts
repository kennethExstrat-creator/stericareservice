"use client";

// What SizeTabs tells the controls in its node panel (not a per-size
// function), so a CounterTable given `activeColumn` shows the size the tabs
// show, in the same layout.
import { createContext } from "react";

export type SizeTabsState = {
  /** The size on screen: the value, or the first ordered size when the value is not ordered. */
  readonly size: string;
  /** From 1280 px every size shows side by side; false keeps one size at every width. */
  readonly sideBySide: boolean;
  /**
   * A child that shows every size side by side needs `width` CSS px for it;
   * null withdraws the need. SizeTabs keeps its tabs from 1280 px when the
   * widest need does not fit.
   */
  readonly requireWidth: (id: string, width: number | null) => void;
};

export const SizeTabsContext = createContext<SizeTabsState | null>(null);
