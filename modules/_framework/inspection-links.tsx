"use client";

// The inspection's links slot (Kenneth, 27 October 2026: the Sampling Plan's
// Export Sampling Plan, the plan sent to the manufacturer): how a Capture
// opens a page of its inspection in a new tab without importing app code,
// as the file slot (file-slot.tsx) and the Steri-AI Summary slot
// (summary-assist.tsx) do. The capture screen wraps its pages in
// <InspectionLinksProvider> with the inspection's links and a way to save
// what is waiting first (capture-screen.tsx), on a read-only inspection too,
// so the page opened has the last change. Where there is no provider (the
// design page, a test), the hook answers null and no such button shows.
import { createContext, useContext, type ReactNode } from "react";

/** What the screen gives a Capture to open its inspection's pages. */
export type InspectionLinks = {
  /** The sampling plan for the manufacturer: /inspections/[id]/sampling-plan/print. */
  readonly samplingPlanPrint: string;
  /** Saves what is waiting (the autosave's flush), briefly; resolves whatever happens, saved or not. */
  saveFirst(): Promise<unknown>;
};

const InspectionLinksContext = createContext<InspectionLinks | null>(null);

/** Given by the capture screen around the pages it renders. */
export function InspectionLinksProvider({ value, children }: { value: InspectionLinks | null; children?: ReactNode }) {
  return <InspectionLinksContext.Provider value={value}>{children}</InspectionLinksContext.Provider>;
}

/** The screen's links, or null where none are given. */
export function useInspectionLinks(): InspectionLinks | null {
  return useContext(InspectionLinksContext);
}
