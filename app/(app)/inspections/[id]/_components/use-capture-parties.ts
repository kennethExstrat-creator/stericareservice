"use client";

// The inspection's client and manufacturer on the capture screen (Kenneth,
// 30 October 2026: "manufacturer and client should be editable"): what the
// screen shows of them, and the slot General Information's Capture changes
// them through (modules/_framework/inspection-parties.tsx). The page gives
// the row's names; a change (changeInspectionParty) shows its answer's names
// at once, in the header line, the card, the Report page's preview and
// every module's context, until the page's own refresh, which the action
// asks for, brings the row's names as props. Props from the server always
// win over a change made before them. The slot is given only where the
// inspection can be changed here and the lists loaded.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EntityRef } from "@/lib/schemas/common";
import type { InspectionParties, InspectionParty, PartyChange, PartyOption } from "@/modules/_framework/inspection-parties";
import { changeInspectionParty, type ChangePartyResult } from "../party-actions";
import { unreachable } from "./unreachable";

/** New Inspection's lists (loadPickerOptions): clients by name, factories by label. */
export type CapturePickers = { clients: readonly PartyOption[]; manufacturers: readonly PartyOption[] };

/** The client and the manufacturer (by its label) as shown, with the brand the header line names. */
export type CaptureParties = {
  client: EntityRef | null;
  manufacturer: EntityRef | null;
  manufacturerBrand: string | null;
};

export function useCaptureParties({
  inspectionId,
  client,
  manufacturer,
  manufacturerBrand,
  pickers,
  editable,
}: CaptureParties & {
  inspectionId: string;
  pickers: CapturePickers | null;
  /** The inspection can be changed here: the slot is given. */
  editable: boolean;
}): { parties: CaptureParties; slot: InspectionParties | null } {
  const fromPage = useMemo<CaptureParties>(
    () => ({ client, manufacturer, manufacturerBrand }),
    [client, manufacturer, manufacturerBrand],
  );
  // A change shown since the page last rendered; dropped once the page renders the row again.
  const [changed, setChanged] = useState<{ page: CaptureParties; shown: CaptureParties } | null>(null);
  const parties = changed !== null && changed.page === fromPage ? changed.shown : fromPage;
  const pageRef = useRef(fromPage);
  useEffect(() => {
    pageRef.current = fromPage;
  }, [fromPage]);

  const change = useCallback(
    async (party: InspectionParty, id: string | null): Promise<PartyChange> => {
      let outcome: ChangePartyResult;
      try {
        outcome = await changeInspectionParty({ inspectionId, party, id });
      } catch (error) {
        return { ok: false, message: unreachable(error).message };
      }
      if (!outcome.ok) return outcome;
      const patch: Partial<CaptureParties> =
        outcome.party === "client"
          ? { client: outcome.client }
          : {
              manufacturer: { id: outcome.manufacturer.id, name: outcome.manufacturer.name },
              manufacturerBrand: outcome.manufacturer.brand,
            };
      setChanged((current) => {
        const page = pageRef.current;
        const base = current !== null && current.page === page ? current.shown : page;
        return { page, shown: { ...base, ...patch } };
      });
      return {
        ok: true,
        address: outcome.party === "manufacturer" && outcome.changed ? outcome.address : null,
        warning: outcome.warning ?? null,
      };
    },
    [inspectionId],
  );

  const slot = useMemo<InspectionParties | null>(
    () => (editable && pickers ? { clients: pickers.clients, manufacturers: pickers.manufacturers, change } : null),
    [editable, pickers, change],
  );
  return { parties, slot };
}
