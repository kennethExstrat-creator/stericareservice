// Text for the review screen. Times are shown in Malaysia, where the team
// works and where the database dates every inspection, and are formatted on
// the server only, so every device reads the same and nothing differs
// between server and browser. Sizes and numbers come from lib/format, as on
// the capture screen (docs/CAPTURE_KIT.md).
import { STATUS_LABEL } from "@/lib/design/status";
import type { InspectionResult } from "@/lib/schemas/common";
import type { InspectionContext } from "@/modules/_framework";

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Kuala_Lumpur",
});

/** A `timestamptz` as `6 Oct 2026, 14:05` (Malaysia time). Anything unreadable is shown as it is. */
export function formatDateTime(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? iso : DATE_TIME.format(time);
}

/**
 * The words for an overall result: the app's suggestion or the inspector's
 * final result. The status pills' own words (lib/design/status.ts), so a
 * result reads the same here as on every other pill.
 */
export const RESULT_LABEL: Readonly<Record<InspectionResult, string>> = {
  pass: STATUS_LABEL.pass,
  fail: STATUS_LABEL.fail,
  hold: STATUS_LABEL.hold,
};

/** Sizes in the order the template lists them; unknown sizes last, as given. */
export function inTemplateOrder(
  context: Pick<InspectionContext, "templateSizes" | "sizes">,
  sizes: readonly string[],
): string[] {
  const order = [...context.sizes, ...context.templateSizes.map((entry) => entry.value)];
  const rank = (size: string) => {
    const index = order.indexOf(size);
    return index === -1 ? order.length : index;
  };
  return [...sizes].sort((a, b) => rank(a) - rank(b));
}

/** "1 photo", "3 photos". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
