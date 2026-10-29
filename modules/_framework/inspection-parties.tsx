"use client";

// The inspection's client and manufacturer slot (Kenneth, 30 October 2026:
// "manufacturer and client should be editable"): how General Information's
// Capture (the header) offers them as pickers without importing app code, as
// the links slot (inspection-links.tsx) opens pages. Both are columns of the
// inspection row, not module data, so a change goes to the server at once,
// never through the autosave. The capture screen wraps its pages in
// <InspectionPartiesProvider> with New Inspection's lists and a change that
// calls its Server Action (capture-screen.tsx), only where the inspection can
// be changed here. Where there is no provider (read-only, the design page, a
// test), the hook answers null and both show read-only.
import { createContext, useContext, type ReactNode } from "react";

/** The two columns: inspections.client_id and inspections.manufacturer_id. */
export type InspectionParty = "client" | "manufacturer";

/** A picker's entry: a client by its name, a factory by its label ("Top Glove · TG-F40"). */
export type PartyOption = { readonly id: string; readonly label: string };

/** The factory addresses a manufacturer change brings, for the header's address (followFactoryAddress). */
export type FactoryAddresses = { readonly previous: string | null; readonly next: string | null };

export type PartyChange =
  /**
   * Changed, or already so. `address`: the old and new factory's stored
   * addresses once a manufacturer changed. `warning`: changed, but something
   * around it was not done (its audit row).
   */
  | { readonly ok: true; readonly address: FactoryAddresses | null; readonly warning: string | null }
  | { readonly ok: false; readonly message: string };

/** What the screen gives General Information's Capture to change the inspection's client and manufacturer. */
export type InspectionParties = {
  /** New Inspection's lists: clients by name, factories by label. */
  readonly clients: readonly PartyOption[];
  readonly manufacturers: readonly PartyOption[];
  /**
   * Changes the inspection's client (null: no client) or manufacturer on the
   * server, which checks the edit rule and writes the audit log. Never
   * throws: a failure, the connection's included, comes back as a message.
   */
  change(party: InspectionParty, id: string | null): Promise<PartyChange>;
};

const InspectionPartiesContext = createContext<InspectionParties | null>(null);

/** Given by the capture screen around the pages it renders; null where the inspection cannot be changed here. */
export function InspectionPartiesProvider({ value, children }: { value: InspectionParties | null; children?: ReactNode }) {
  return <InspectionPartiesContext.Provider value={value}>{children}</InspectionPartiesContext.Provider>;
}

/** The screen's pickers, or null where the client and manufacturer are read-only. */
export function useInspectionParties(): InspectionParties | null {
  return useContext(InspectionPartiesContext);
}
