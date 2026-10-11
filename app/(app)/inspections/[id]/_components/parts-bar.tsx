"use client";

// The PO parts of the inspection, under the capture header (lib/inspections
// parts.ts; Kenneth, 11 October 2026): one inspection can cover several
// purchase orders, each a part with its own PO, lots, sizes, sampling, tests
// and result. One pill per part, in the order they were added, as the shell's
// page pills look (components/shell/nav-list.tsx): the open part marked
// (aria-current), each other a link to its own capture screen on the page
// the inspector is on (?module=, which the screen keeps in the address), with
// its status when it differs from this part's. A link leaves as the header's
// links do: the field being typed is left and the last change saved first
// (onLeave, the screen's leaveTo). Add PO adds an empty part and opens it,
// where this user may change the inspection. The pills scroll sideways; the
// page never does.
import { useEffect, useRef, type ComponentProps } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { partLabel, type InspectionPart } from "@/lib/inspections/parts";
import type { InspectionStatus } from "@/lib/schemas/common";
import { cn } from "@/lib/utils";
import { InspectionStatusBadge } from "../../_components/inspection-status-badge";
import { AddPartDialog } from "./add-part-dialog";
import { partHref } from "./part-nav";

export type PartsBarProps = {
  /** Every part, first part first (loadParts). */
  parts: readonly InspectionPart[];
  /** The open part's id. */
  currentId: string;
  /** The open part's status, as the last save found it. */
  status: InspectionStatus;
  /** Add PO is offered: the inspection is draft or reopened, and this user's to change. */
  canAdd: boolean;
  /** The inspection's reference number. */
  refNo: string;
  /** Leaves for another part once the last change is saved (the screen's leaveTo); a plain link without it. */
  onLeave?: (href: string) => void;
  /** Where the screen is leaving for, while the last change is saved. */
  leavingTo?: string | null;
  className?: string;
};

/** Compact with a mouse, 44 px on touch. The focus ring is inset: the scroller would clip an outer one. */
const PILL =
  "relative inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-4 text-sm whitespace-nowrap outline-none transition-colors focus-ring-inset touch:h-11 touch:text-base";

export function PartsBar({ parts, currentId, status, canAdd, refNo, onLeave, leavingTo = null, className }: PartsBarProps) {
  const router = useRouter();
  // The page the inspector is on, which the screen keeps in the address as they move (?module=).
  const moduleKey = useSearchParams().get("module");
  const scroller = useRef<HTMLDivElement>(null);
  const currentPill = useRef<HTMLSpanElement>(null);

  // The open part in view when the pills scroll sideways, without scrolling the page (scrollIntoView would).
  useEffect(() => {
    const bar = scroller.current;
    const pill = currentPill.current;
    if (!bar || !pill || bar.scrollWidth <= bar.clientWidth) return;
    const left = pill.getBoundingClientRect().left - bar.getBoundingClientRect().left + bar.scrollLeft;
    if (left + pill.offsetWidth > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = left + pill.offsetWidth - bar.clientWidth + 16;
  }, [currentId]);

  /** Next.js's navigation is held while the screen saves, then follows the link (as its header links do). */
  const onNavigate = (href: string): ComponentProps<typeof Link>["onNavigate"] =>
    onLeave
      ? (event) => {
          event.preventDefault();
          onLeave(href);
        }
      : undefined;

  return (
    <nav
      aria-label="POs in this inspection"
      data-slot="capture-parts"
      className={cn("flex min-w-0 items-center gap-2", className)}
    >
      <div ref={scroller} className="min-w-0 overflow-x-auto [scrollbar-width:none]">
        <ul className="flex w-max items-center gap-2">
          {parts.map((part, index) => {
            const label = partLabel(part, index);
            if (part.id === currentId) {
              return (
                <li key={part.id} className="flex">
                  <span
                    ref={currentPill}
                    aria-current="page"
                    data-part={part.id}
                    className={cn(PILL, "border-brand-200 bg-accent font-semibold text-accent-foreground")}
                  >
                    <span className="max-w-56 truncate">{label}</span>
                  </span>
                </li>
              );
            }
            const href = partHref(part.id, moduleKey);
            const leaving = leavingTo === href;
            return (
              <li key={part.id} className="flex">
                <Link
                  href={href}
                  onNavigate={onNavigate(href)}
                  aria-busy={leaving || undefined}
                  data-part={part.id}
                  className={cn(PILL, "border-border bg-card font-medium text-foreground hover:bg-muted")}
                >
                  {leaving && <Spinner aria-hidden />}
                  <span className="max-w-56 truncate">{label}</span>
                  {part.status !== status && <InspectionStatusBadge status={part.status} />}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      {canAdd && (
        <AddPartDialog
          inspectionId={currentId}
          refNo={refNo}
          onAdded={(partId, poNo) => {
            // Added last, so it is the next PO in the list.
            toast.success(`${partLabel({ poNo }, parts.length)} was added to ${refNo}.`);
            // Its first page: Source Documents.
            const href = partHref(partId, null);
            if (onLeave) onLeave(href);
            else router.push(href);
          }}
        />
      )}
    </nav>
  );
}
