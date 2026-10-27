// "Needs Your Attention" (layout A, Kenneth, 27 October 2026): every error
// and warning the checks found, one short line per problem with the module
// it is in and its sizes, near the top instead of under each module. Show
// opens the module in the results; a label the template does not list gets
// Map Label, for those who look after the defect codes.
import Link from "next/link";
import { CircleXIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AttentionItem } from "@/lib/inspections/review/attention";
import { cn } from "@/lib/utils";

/** The issue code of a one-off defect label (modules/visual, modules/watertight). */
export const UNMAPPED_CODE = "defect_unmapped";
export const UNMAPPED_LABELS_PATH = "/admin/defects/unmapped";

/** "M 2, L 2, XL 1", or "M, L" when the sentences named no count. */
export function sizesText(item: Pick<AttentionItem, "sizes">, label: (size: string) => string): string {
  return item.sizes.map((entry) => (entry.count === null ? label(entry.size) : `${label(entry.size)} ${entry.count}`)).join(", ");
}

export function Attention({
  items,
  titleOf,
  anchorOf,
  sizeLabel,
  canMapLabels,
}: {
  items: readonly AttentionItem[];
  /** A module's title as the review shows it. */
  titleOf: (moduleKey: string) => string;
  /** Its row's id in the module results. */
  anchorOf: (moduleKey: string) => string;
  sizeLabel: (size: string) => string;
  /** The role's Defects switch: the unmapped labels page. */
  canMapLabels: boolean;
}) {
  if (items.length === 0) return null;
  const errors = items.some((item) => item.level === "error");
  return (
    <section
      id="attention"
      aria-labelledby="attention-heading"
      className={cn("rounded-xl border", errors ? "border-fail-border bg-fail-tint" : "border-warn-border bg-warn-tint")}
    >
      <h2 id="attention-heading" className="sr-only">
        Needs Your Attention
      </h2>
      <ul className={cn("divide-y", errors ? "divide-fail-border/60" : "divide-warn-border/60")}>
        {items.map((item) => {
          const error = item.level === "error";
          const Icon = error ? CircleXIcon : TriangleAlertIcon;
          const sizes = sizesText(item, sizeLabel);
          return (
            <li
              key={item.key}
              data-issue={item.code}
              data-level={item.level}
              className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 px-5 py-3"
            >
              <p className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5 gap-y-1 text-base fine:text-sm">
                <Icon aria-hidden className={cn("size-4 shrink-0 self-center", error ? "text-fail" : "text-warn")} />
                <span className="sr-only">{error ? "Error:" : "Warning:"} </span>
                <span className={cn("font-semibold", error ? "text-fail" : "text-warn")}>{titleOf(item.moduleKey)}</span>{" "}
                <span className="text-foreground [overflow-wrap:anywhere]">{item.text}</span>
                {sizes && (
                  <>
                    {" "}
                    <span className="text-muted-foreground">{sizes}</span>
                  </>
                )}
              </p>
              <span className="flex shrink-0 items-center gap-3">
                <Button asChild variant="outline" size="sm" className="bg-card">
                  <a href={`#${anchorOf(item.moduleKey)}`}>Show</a>
                </Button>
                {item.code === UNMAPPED_CODE && canMapLabels && (
                  <Button asChild variant="link" size="sm" className="px-0">
                    <Link href={UNMAPPED_LABELS_PATH}>Map Label</Link>
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
