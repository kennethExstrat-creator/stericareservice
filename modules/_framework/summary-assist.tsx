"use client";

// The Steri-AI Summary slot (docs/AI.md, "Steri-AI Summary"; 12 October
// 2026): how the conclusion's Capture asks the screen for a Steri-AI draft
// of its Inspection Summary without importing app code, as the file slot
// does for files (file-slot.tsx). The capture screen wraps the module bodies
// in <SummaryAssistProvider> with a value that saves what is waiting first
// (the autosave's flush) and then calls the server action with the saved
// data's hash (section-body.tsx, capture-screen.tsx). Where the inspection
// cannot be changed, or there is no provider at all (the template editor's
// preview, a test), the hook answers null and the button does not show. The
// draft is only ever text: the Capture puts it in through the editor, and
// autosave saves it.
import { createContext, useContext, type ReactNode } from "react";
import type { SummaryAssistResult, SummaryMenu, SummaryOptions } from "@/lib/schemas/summary-style";

/** What the screen gives the conclusion's Capture for the Steri-AI Summary button. */
export type SummaryAssist = {
  /** The house style's menu (loadSummaryMenu): what the inspector may change for one summary. */
  readonly menu: SummaryMenu;
  /**
   * Saves what is waiting, then asks Steri-AI for a draft of the saved data.
   * Never throws: a failure, the screen's own included (not everything saved,
   * the server unreachable), comes back as `{ ok: false, reason, message }`.
   */
  draft(options: SummaryOptions): Promise<SummaryAssistResult>;
  /** summaryBasisHash of the data on screen now, to compare with a draft's `basis`. */
  basisNow(): string;
  /** With `userId`: where this device keeps the draft mark and the menu choices, per inspection and user. */
  readonly inspectionId: string;
  readonly userId: string;
};

const SummaryAssistContext = createContext<SummaryAssist | null>(null);

/** Given by the capture screen around the modules it renders; null where the inspection cannot be changed here. */
export function SummaryAssistProvider({ value, children }: { value: SummaryAssist | null; children?: ReactNode }) {
  return <SummaryAssistContext.Provider value={value}>{children}</SummaryAssistContext.Provider>;
}

/** The screen's Steri-AI Summary, or null where no button shows. */
export function useSummaryAssist(): SummaryAssist | null {
  return useContext(SummaryAssistContext);
}
