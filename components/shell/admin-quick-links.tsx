// The admin home's shortcuts (app/(app)/admin/page.tsx): what waits for an
// admin, then every admin screen. The page reads the one live number, the
// inspections awaiting approval; this only shows it, so each state is tested
// (admin-quick-links.test.tsx). Unmapped defect labels are linked, not
// counted: counting them reads every open inspection's data (lib/admin/defects).
import Link from "next/link";
import {
  ArrowRightIcon,
  Building2Icon,
  ClipboardCheckIcon,
  FactoryIcon,
  FlagIcon,
  LayoutTemplateIcon,
  SendIcon,
  SparklesIcon,
  TagsIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { HOME_PATH } from "@/lib/auth/routes";
import { buildInspectionsHref } from "@/lib/inspections/search-params";
import { cn } from "@/lib/utils";
import {
  ADMIN_CLIENTS_PATH,
  ADMIN_DEFECTS_PATH,
  ADMIN_MANUFACTURERS_PATH,
  ADMIN_AI_PATH,
  ADMIN_TEMPLATES_PATH,
  ADMIN_USERS_PATH,
} from "./nav";

/** The list filtered to what an admin approves or reopens. */
export const AWAITING_APPROVAL_HREF = buildInspectionsHref({ status: "submitted" });

/** UNMAPPED_PATH in lib/admin/defects.ts: one-off labels waiting for a code. */
export const UNMAPPED_LABELS_HREF = `${ADMIN_DEFECTS_PATH}/unmapped`;

type QuickLinkProps = {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  /** A number for the eye beside the title; the description says it in words. */
  count?: number;
};

/** The first section: inspections waiting for an admin, and the whole list. `awaitingApproval` is null when it could not be counted. */
export function InspectionShortcuts({ awaitingApproval }: { awaitingApproval: number | null }) {
  return (
    <QuickLinks
      links={[
        {
          href: AWAITING_APPROVAL_HREF,
          icon: SendIcon,
          title: "Awaiting Approval",
          description: awaitingDescription(awaitingApproval),
          count: awaitingApproval ?? undefined,
        },
        {
          href: HOME_PATH,
          icon: ClipboardCheckIcon,
          title: "All Inspections",
          description: "Every inspection, from every inspector, newest first.",
        },
      ]}
      className="md:grid-cols-2"
    />
  );
}

/** The second section: every admin screen of BUILD_SPEC 10, in the nav's order. */
export function AdminScreenLinks() {
  return (
    <QuickLinks
      links={[
        {
          href: ADMIN_USERS_PATH,
          icon: UsersIcon,
          title: "Users",
          description: "Invite people, set roles and deactivate accounts.",
        },
        {
          href: ADMIN_MANUFACTURERS_PATH,
          icon: FactoryIcon,
          title: "Manufacturers",
          description: "The factories you inspect at, with their addresses.",
        },
        {
          href: ADMIN_CLIENTS_PATH,
          icon: Building2Icon,
          title: "Clients",
          description: "The companies you inspect for, with their logos.",
        },
        {
          href: ADMIN_DEFECTS_PATH,
          icon: TagsIcon,
          title: "Defect Codes",
          description: "Codes, label mapping and inspectors' shortforms.",
        },
        {
          href: UNMAPPED_LABELS_HREF,
          icon: FlagIcon,
          title: "Unmapped Labels",
          description: "One-off defect labels inspectors added, waiting for a code.",
        },
        {
          href: ADMIN_TEMPLATES_PATH,
          icon: LayoutTemplateIcon,
          title: "Templates",
          description: "Each template's versions, the editor, activating and retiring.",
        },
        {
          href: ADMIN_AI_PATH,
          icon: SparklesIcon,
          title: "Steri-AI Settings",
          description: "The API key, the models and what Steri-AI costs.",
        },
      ]}
      className="md:grid-cols-2 xl:grid-cols-3"
    />
  );
}

function awaitingDescription(count: number | null): string {
  if (count === null) return "Submitted inspections, for you to approve or reopen.";
  if (count === 0) return "Nothing to approve: no inspection is submitted.";
  return `${count} submitted ${count === 1 ? "inspection" : "inspections"} to approve or reopen.`;
}

function QuickLinks({ links, className }: { links: QuickLinkProps[]; className?: string }) {
  return (
    <ul className={cn("grid gap-4 xl:gap-6", className)}>
      {links.map((link) => (
        <li key={link.href}>
          <QuickLink {...link} />
        </li>
      ))}
    </ul>
  );
}

function QuickLink({ href, icon: Icon, title, description, count }: QuickLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        // h-full: cards in one row match height when one description wraps.
        "group flex h-full items-center gap-4 rounded-xl bg-card p-5 shadow-sm ring-1 ring-border transition-colors",
        "hover:ring-brand-300 focus-ring",
      )}
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent text-brand-600">
        <Icon aria-hidden className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="font-display text-base font-bold text-foreground">{title}</span>
          {count !== undefined && count > 0 && (
            <span
              aria-hidden
              data-slot="quick-link-count"
              className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-brand-200 bg-brand-50 px-2 text-sm font-semibold text-brand-700 tabular-nums"
            >
              {count}
            </span>
          )}
        </span>
        <span className="block text-sm text-muted-foreground touch:text-base">{description}</span>
      </span>
      <ArrowRightIcon aria-hidden className="size-5 shrink-0 text-slate-500 transition-colors group-hover:text-brand-600" />
    </Link>
  );
}
