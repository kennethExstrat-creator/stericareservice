// The top of the capture screen, kept short (Kenneth: too much in it before):
// the reference number and workflow status, one line with the client and the
// manufacturer, and the page's actions (Photos, Review, on the iPad Issues and
// Submit, and Back to the list last, on the right). Below 1280 px the actions
// take their own row under the title, so touch-size buttons never squeeze it.
//
// PO parts (lib/inspections/parts.ts): every part of an inspection of several
// POs is titled with the inspection's reference number, the first part's,
// with a line saying which part this is ("PO 1000002 · Part 2 of 3") and,
// small, the part's own reference. The parts bar below moves between the
// parts and adds one (parts-bar.tsx).
import type { ReactNode } from "react";
import { PageHeader } from "@/components/qc";
import { isEditableStatus } from "@/lib/inspections/capture/access";
import { groupRefNo, type InspectionPart } from "@/lib/inspections/parts";
import type { InspectionStatus } from "@/lib/schemas/common";
import { InspectionStatusBadge } from "../../_components/inspection-status-badge";
import { partPosition } from "./part-nav";
import { PartsBar } from "./parts-bar";

/** The inspection's PO parts, as the header shows them. */
export type CaptureParts = {
  /** Every part, first part first (loadParts). */
  list: readonly InspectionPart[];
  /** This part's id: the inspection on screen. */
  currentId: string;
  /** This user may add a PO here: draft or reopened, and theirs or they are an admin (captureAccess). */
  canAdd: boolean;
};

export type CaptureHeading = {
  refNo: string;
  status: InspectionStatus;
  templateName: string;
  templateVersion: number;
  clientName: string | null;
  manufacturerLabel: string | null;
  /** The manufacturer's name without its factory, for the header line. */
  manufacturerName?: string | null;
  inspectionDate: string;
  inspectorName: string;
  /** The inspection's PO parts; null or absent when they could not be read: this part alone, then. */
  parts?: CaptureParts | null;
};

type CaptureHeaderProps = {
  heading: CaptureHeading;
  actions?: ReactNode;
  /** Leaves for another part once the last change is saved (the screen's leaveTo, as its header links). */
  onLeave?: (href: string) => void;
  /** Where the screen is leaving for, while the last change is saved. */
  leavingTo?: string | null;
};

export function CaptureHeader({ heading, actions, onLeave, leavingTo = null }: CaptureHeaderProps) {
  // Who the inspection is for and where: the template, date and inspector are on the
  // sections themselves (header module) and in the list.
  const facts = [heading.clientName, heading.manufacturerName ?? heading.manufacturerLabel].filter(
    (fact): fact is string => Boolean(fact),
  );
  const parts = heading.parts ?? null;
  // The inspection's reference on every part: the first part's.
  const title = (parts && groupRefNo(parts.list)) ?? heading.refNo;
  const part = parts ? partPosition(parts.list, parts.currentId) : null;
  // As the last save found it: submitted on another device, no PO is added here.
  const canAdd = parts !== null && parts.canAdd && isEditableStatus(heading.status);

  return (
    <div data-slot="capture-header" className="flex flex-col gap-4">
      <PageHeader
        className="md:flex-col md:items-stretch xl:flex-row xl:items-end"
        title={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="tabular-nums">{title}</span>
            <InspectionStatusBadge status={heading.status} className="align-middle" />
          </span>
        }
        description={
          <div className="space-y-1">
            {part && (
              <p
                data-slot="capture-part"
                className="flex flex-wrap items-baseline gap-x-2 font-semibold text-foreground touch:text-lg"
              >
                <span className="min-w-0 break-words">{part.label}</span>
                <span aria-hidden>·</span>
                <span>{part.position}</span>
                {/* Small: the part's own reference, the inspection's being the title. */}
                {part.refNo !== title && (
                  <span className="text-xs font-normal text-muted-foreground tabular-nums touch:text-sm">
                    {part.refNo}
                  </span>
                )}
              </p>
            )}
            {/* The dot stays at the end of a line when the facts wrap, never at the start of the next. */}
            <p className="flex flex-wrap gap-x-2 text-sm touch:text-base">
              {facts.map((fact, index) => (
                <span key={`${index}-${fact}`}>
                  {fact}
                  {index < facts.length - 1 && (
                    <span aria-hidden className="ml-2">
                      ·
                    </span>
                  )}
                </span>
              ))}
            </p>
          </div>
        }
        actions={actions}
      />
      {/* Several POs to move between, or Add PO to make a second. */}
      {parts && (parts.list.length > 1 || canAdd) && (
        <PartsBar
          parts={parts.list}
          currentId={parts.currentId}
          status={heading.status}
          canAdd={canAdd}
          refNo={title}
          onLeave={onLeave}
          leavingTo={leavingTo}
        />
      )}
    </div>
  );
}
