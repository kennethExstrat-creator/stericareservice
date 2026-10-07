// The nav, drawn three ways from one config (./nav.ts): the desktop sidebar
// list, the iPad top-bar tabs and the iPad section row (admin pages).
// Server Components: only NavLink reads the URL on the client.
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { plannedByPhase, type NavEntry, type NavPlannedEntry, type NavSection } from "./nav";
import { NavIcon } from "./nav-icon";
import { NavLink } from "./nav-link";

/* ---- Desktop sidebar: sections as a vertical list ---------------------- */

const SIDEBAR_LINK = cn(
  "group relative flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium text-foreground transition-colors",
  "hover:bg-muted focus-ring-inset touch:h-11 touch:text-base",
  // Current page: tinted, bold, and a brand bar on the left edge.
  "aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground",
  "before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full aria-[current]:before:bg-brand-500",
);

export function SidebarNav({ sections, className }: { sections: readonly NavSection[]; className?: string }) {
  return (
    <nav aria-label="Main" className={cn("space-y-6", className)}>
      {sections.map((section) => {
        const headingId = `sidebar-nav-${section.key}`;
        return (
          <div key={section.key}>
            {section.label && (
              <p id={headingId} className="px-3 pb-2 text-xs font-bold tracking-[0.2em] text-brand-600 uppercase">
                {section.label}
              </p>
            )}
            <ul aria-labelledby={section.label ? headingId : undefined} className="space-y-0.5">
              {section.entries.map((entry) => (
                <li key={entry.key}>
                  <SidebarEntry entry={entry} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function SidebarEntry({ entry }: { entry: NavEntry }) {
  if (entry.kind === "planned") {
    return (
      <div className="flex h-9 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground touch:h-11 touch:text-base">
        <NavIcon name={entry.icon} className="size-4 shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
        <PlannedBadge entry={entry} />
      </div>
    );
  }
  return (
    <NavLink href={entry.href} match={entry.match} className={SIDEBAR_LINK}>
      <NavIcon name={entry.icon} className="size-4 shrink-0 text-slate-500 group-aria-[current]:text-brand-600" />
      <span className="truncate">{entry.label}</span>
    </NavLink>
  );
}

/* ---- iPad top bar: one tab per section ---------------------------------- */

const TAB_LINK = cn(
  "group relative inline-flex h-full items-center gap-2 px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors",
  "hover:text-foreground focus-ring-inset touch:px-4 touch:text-base",
  // Current section: dark, bold and underlined in brand blue.
  "aria-[current]:font-semibold aria-[current]:text-foreground",
  "after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:rounded-t-full aria-[current]:after:bg-brand-500",
);

/** Below 480 px (Slide Over) a tab shows its icon only; the label stays for screen readers. */
export function TabNav({ sections, className }: { sections: readonly NavSection[]; className?: string }) {
  return (
    <nav aria-label="Main" className={cn("h-full", className)}>
      <ul className="flex h-full items-stretch gap-1">
        {sections.map(({ key, tab }) => (
          <li key={key} className="flex">
            <NavLink href={tab.href} match={tab.match} className={TAB_LINK}>
              <NavIcon name={tab.icon} className="size-4 shrink-0 text-slate-500 group-aria-[current]:text-brand-600" />
              <span className="max-[30rem]:sr-only">{tab.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* ---- iPad section row: the current section's own pages ------------------ */

const SECTION_LINK = cn(
  "inline-flex h-9 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium whitespace-nowrap text-foreground transition-colors",
  "hover:bg-muted focus-ring touch:h-11 touch:text-base",
  "aria-[current]:border-brand-200 aria-[current]:bg-accent aria-[current]:font-semibold aria-[current]:text-accent-foreground",
);

const plannedList = new Intl.ListFormat("en-GB", { style: "long", type: "conjunction" });

/**
 * Below 1280 px the sidebar is gone, so a section with pages of its own (Admin)
 * lists them in a row at the top of its pages: its pages as pills, then what
 * is planned, one line per phase. Hide it from 1280 px with xl:hidden.
 */
export function SectionNav({ section, className }: { section: NavSection; className?: string }) {
  const links = section.entries.filter((entry) => entry.kind === "link");
  return (
    <nav
      aria-label={section.label ?? section.tab.label}
      className={cn("flex flex-wrap items-center gap-x-5 gap-y-3", className)}
    >
      <ul className="flex flex-wrap gap-2">
        {links.map((entry) => (
          <li key={entry.key} className="flex">
            <NavLink href={entry.href} match={entry.match} className={SECTION_LINK}>
              {/* An element, so a link waiting to leave dims its label and not its focus ring (leave-guard-area.tsx). */}
              <span>{entry.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
      {plannedByPhase(section.entries).map(({ phase, labels }) => (
        <p key={phase} className="flex items-center gap-2 text-sm text-muted-foreground touch:text-base">
          <Badge aria-hidden variant="outline" className="shrink-0 font-semibold text-muted-foreground">
            {phase}
          </Badge>
          <span>
            <span className="sr-only">Coming in {phase}: </span>
            {plannedList.format(labels)}
          </span>
        </p>
      ))}
    </nav>
  );
}

/* ---- Shared -------------------------------------------------------------- */

/** "Phase 3" on a planned entry; screen readers hear "Manufacturers, coming in Phase 3". */
function PlannedBadge({ entry }: { entry: NavPlannedEntry }) {
  return (
    <>
      <span className="sr-only">, coming in</span>
      <Badge variant="outline" className="shrink-0 font-semibold text-muted-foreground">
        {entry.phase}
      </Badge>
    </>
  );
}
