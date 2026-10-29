// The inspection's client or manufacturer changed on the capture screen's
// General Information (Kenneth, 30 October 2026: "manufacturer and client
// should be editable"): one audit row for each change, naming the old and the
// new as they read at the time, the client by its name and the factory by its
// label ("Top Glove · TG-F40"), so the record stays true when a name is
// edited later. changeInspectionParty (app/(app)/inspections/[id]
// party-actions.ts) writes it once the column is written; the Audit Log page
// (audit-log.ts) reads "Client changed from Client A to Client B."

export const CLIENT_CHANGED = "client_changed";
export const MANUFACTURER_CHANGED = "manufacturer_changed";

/** The two columns General Information changes: inspections.client_id and inspections.manufacturer_id. */
export type InspectionParty = "client" | "manufacturer";

/** A client or a factory as the row named it then. */
export type PartyRef = { id: string; name: string };

/** What the client picker, and the audit log, call an inspection without a client (as on New Inspection). */
export const NO_CLIENT_LABEL = "No Client";

/** What changeInspectionParty answers when it changes nothing, or changes without its audit row. */
export const PARTY_MESSAGES = {
  invalid: "The request was not understood. Reload the page and try again.",
  clientGone: "That client is no longer in the list. Reload the page and try again.",
  manufacturerGone: "That manufacturer is no longer in the list. Reload the page and try again.",
  changedMeanwhile: "This inspection changed in the meantime. Reload the page and try again.",
  notSaved: "The change could not be saved. Try again in a moment.",
  notLogged: "Changed, but the change could not be added to the audit log.",
} as const;

const WORD: Readonly<Record<InspectionParty, string>> = { client: "Client", manufacturer: "Manufacturer" };

/** An audit row's changes: the client or factory before and after, null for no client. */
export type PartyChanges = { from: PartyRef | null; to: PartyRef | null };

/** The audit row of one change: `{ from, to }`, each `{ id, name }`, or null for no client. */
export function partyChangedEvent(party: InspectionParty, from: PartyRef | null, to: PartyRef | null): { action: string; changes: PartyChanges } {
  return {
    action: party === "client" ? CLIENT_CHANGED : MANUFACTURER_CHANGED,
    changes: { from: from && { id: from.id, name: from.name }, to: to && { id: to.id, name: to.name } },
  };
}

/** The Audit Log's title: "Client Changed", "Manufacturer Changed". */
export function partyChangeTitle(party: InspectionParty): string {
  return `${WORD[party]} Changed`;
}

/**
 * "Client changed from Client A to Client B.", "Client changed from Client A
 * to No Client.", "Manufacturer changed from Top Glove · TG-F40 to Hartalega
 * NGC." A name the row lost reads "unknown".
 */
export function partyChangeSentence(party: InspectionParty, changes: Record<string, unknown>): string {
  return `${WORD[party]} changed from ${partyName(party, changes.from)} to ${partyName(party, changes.to)}.`;
}

function partyName(party: InspectionParty, value: unknown): string {
  if (value === null || value === undefined) return party === "client" ? NO_CLIENT_LABEL : "unknown";
  const name = typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>).name : undefined;
  return typeof name === "string" && name.trim() !== "" ? name.trim() : "unknown";
}
