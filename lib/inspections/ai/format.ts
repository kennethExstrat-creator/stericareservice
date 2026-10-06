// Text for the AI panel. Times are formatted on the server, in Malaysia
// time where SteriCare works (ref numbers use the same zone), so the server
// and the browser always render the same string.
import type { AiReviewActionKind, FindingSeverity } from "@/lib/schemas/ai-review";
import type { InspectionResult } from "@/lib/schemas/common";
import { tagLine } from "@/components/qc/photo-tags";
import { parseTarget } from "@/lib/photos/target";
import type { Status } from "@/lib/design/status";

export const PANEL_TIME_ZONE = "Asia/Kuala_Lumpur";

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: PANEL_TIME_ZONE,
});

/** "6 Oct 2026, 14:02"; anything unreadable is shown as it is. */
export function formatDateTime(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? iso : DATE_TIME.format(time);
}

/** Overall results share the status colours and words: hold is the amber "On hold". */
export const RESULT_STATUS: Readonly<Record<InspectionResult, Status>> = {
  pass: "pass",
  fail: "fail",
  hold: "hold",
};

export const SEVERITY_LABEL: Readonly<Record<FindingSeverity, string>> = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
  info: "Info",
};

/** Severity reuses the status colours for urgency: critical red, major amber, minor and info slate. */
export const SEVERITY_STATUS: Readonly<Record<FindingSeverity, Status>> = {
  critical: "fail",
  major: "warn",
  minor: "info",
  info: "info",
};

export const DECISION_LABEL: Readonly<Record<AiReviewActionKind, string>> = {
  agree: "Agreed",
  disagree: "Disagreed",
  fixed: "Fixed",
};

/** The button that records each decision. */
export const DECISION_VERB: Readonly<Record<AiReviewActionKind, string>> = {
  agree: "Agree",
  disagree: "Disagree",
  fixed: "Fixed",
};

/** 0.7 as 70. */
export function confidencePercent(confidence: number | null): number | null {
  if (confidence === null || !Number.isFinite(confidence)) return null;
  return Math.round(Math.min(1, Math.max(0, confidence)) * 100);
}

/** "Visual Inspection · Size M · thin_spot · Box 253" from a photo's module title and target. */
export function photoTagLine(moduleTitle: string | null, target: string | null): string | null {
  const parsed = parseTarget(target);
  const tags = parsed.ok ? parsed.target : {};
  const line = tagLine({
    module: moduleTitle ?? "",
    size: tags.size,
    hand: tags.hand,
    defect: tags.defect,
    box: tags.box === undefined ? undefined : String(tags.box),
  });
  return line.trim() === "" ? null : line;
}
