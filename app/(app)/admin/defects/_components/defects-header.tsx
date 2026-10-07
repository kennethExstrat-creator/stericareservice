// The top of every /admin/defects tab: the page header and the row of tabs.
// No hooks, so server pages and the codes tab's client component both use it.
import Link from "next/link";
import type { ReactNode } from "react";
import { FlagIcon, TriangleAlertIcon, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/qc";
import { DEFECTS_PATH, LABEL_MAPPING_PATH, UNMAPPED_PATH, type DefectsCounts } from "@/lib/admin/defects";
import { cn } from "@/lib/utils";

export type DefectsTab = "codes" | "labels" | "unmapped";

const TABS: readonly { key: DefectsTab; label: string; href: string }[] = [
  { key: "codes", label: "Codes", href: DEFECTS_PATH },
  { key: "labels", label: "Label mapping", href: LABEL_MAPPING_PATH },
  { key: "unmapped", label: "Unmapped labels", href: UNMAPPED_PATH },
];

// Underlined like the iPad top bar's tabs, so they never read as the admin
// section's pills above them. 44 px on touch.
const TAB = cn(
  "relative inline-flex h-10 items-center gap-2 px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors",
  "hover:text-foreground focus-ring-inset touch:h-11 touch:px-4 touch:text-base",
  "aria-[current=page]:font-semibold aria-[current=page]:text-foreground",
  "after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:rounded-t-full aria-[current=page]:after:bg-brand-500",
);

const COUNT = "inline-flex h-5 min-w-5 items-center justify-center gap-1 rounded-full border px-1.5 text-xs font-semibold tabular-nums";

/**
 * A tab's number: neutral for the code count; amber with an icon, and only
 * when above 0, for what waits for an admin. The icon and number are for the
 * eye; screen readers hear the words.
 */
function TabCount({ value, spoken, warn }: { value: number; spoken: string; warn?: LucideIcon }) {
  if (warn && value === 0) return null;
  const Icon = warn;
  return (
    <>
      <span
        aria-hidden
        className={cn(
          COUNT,
          Icon ? "border-warn-border bg-warn-tint text-warn [&>svg]:size-3" : "border-border bg-slate-100 text-slate-700",
        )}
      >
        {Icon && <Icon />}
        {value}
      </span>
      <span className="sr-only">, {spoken}</span>
    </>
  );
}

function countOf(key: DefectsTab, counts: DefectsCounts) {
  switch (key) {
    case "codes":
      return <TabCount value={counts.codes} spoken={`${counts.codes} ${counts.codes === 1 ? "code" : "codes"}`} />;
    case "labels":
      return (
        <TabCount
          value={counts.attention}
          warn={TriangleAlertIcon}
          spoken={`${counts.attention} ${counts.attention === 1 ? "label needs" : "labels need"} attention`}
        />
      );
    case "unmapped":
      return <TabCount value={counts.unmapped} warn={FlagIcon} spoken={`${counts.unmapped} waiting for a code`} />;
  }
}

export function DefectsHeader({
  current,
  counts,
  actions,
}: {
  current: DefectsTab;
  counts: DefectsCounts;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Admin"
        title="Defects"
        actions={actions}
      />
      <nav aria-label="Defects" className="border-b border-border">
        <ul className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <li key={tab.key} className="flex">
              <Link
                href={tab.href}
                aria-current={tab.key === current ? "page" : undefined}
                className={TAB}
                data-tab={tab.key}
              >
                {tab.label}
                {countOf(tab.key, counts)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
