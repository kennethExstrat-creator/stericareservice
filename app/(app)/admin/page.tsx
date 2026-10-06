import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, ClipboardCheckIcon, UsersIcon, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/qc";
import {
  AiReportCard,
  AiReviewCard,
  EmailCard,
  SupabaseCard,
  type DatabaseSummary,
} from "@/components/shell/admin-status-cards";
import { ADMIN_USERS_PATH, navForRole, plannedByPhase } from "@/components/shell/nav";
import { getAiStatus } from "@/lib/ai";
import { HOME_PATH } from "@/lib/auth/routes";
import { requireAdmin } from "@/lib/auth/session";
import { getSiteUrl, getSupabasePublicEnv } from "@/lib/env";
import { isAdminClientConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

/**
 * The title checks the role too. Next resolves metadata on its own, so a
 * static title would still name this page on an inspector's 404 (in the tab
 * and the HTML); notFound() here swaps in the 404 page's metadata. The
 * session is cached per request, so this adds no query.
 */
export async function generateMetadata(): Promise<Metadata> {
  await requireAdmin();
  return { title: "Admin overview" };
}

/**
 * System status for admins: is Supabase wired up, are the sign-in emails
 * set up, are the AI hand-offs connected. This page reads the facts; the
 * cards (components/shell/admin-status-cards.tsx) show them, naming the
 * variable to set, never a value: no keys, secrets or webhook URLs reach it.
 */
export default async function AdminOverviewPage() {
  const user = await requireAdmin();

  const supabaseEnv = getSupabasePublicEnv();
  const secretKeySet = isAdminClientConfigured();
  const database = await readDatabaseSummary();
  const ai = getAiStatus();
  // A production build without NEXT_PUBLIC_SITE_URL only knows getSiteUrl()'s
  // localhost fallback, so the email card asks for the variable instead of
  // showing a wrong address. Read with a literal expression (see lib/env.ts).
  const siteUrl =
    process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_SITE_URL?.trim() ? null : getSiteUrl();
  const comingLater = plannedByPhase(navForRole(user.role).flatMap((section) => section.entries));

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Admin"
        title="Overview"
        description="Set-up checks and shortcuts. Only admins see this page."
      />

      <section aria-labelledby="system-status" className="space-y-4">
        <h2 id="system-status" className="text-2xl font-bold tracking-tight text-foreground">
          System status
        </h2>
        <div className="grid gap-6 lg:grid-cols-2">
          <SupabaseCard env={supabaseEnv} secretKeySet={secretKeySet} database={database} />
          <EmailCard env={supabaseEnv} siteUrl={siteUrl} />
          <AiReviewCard status={ai.review} />
          <AiReportCard status={ai.report} />
        </div>
      </section>

      <section aria-labelledby="quick-links" className="space-y-4">
        <h2 id="quick-links" className="text-2xl font-bold tracking-tight text-foreground">
          Quick links
        </h2>
        <ul className="grid gap-6 md:grid-cols-2">
          <li>
            <QuickLink
              href={ADMIN_USERS_PATH}
              icon={UsersIcon}
              title="Users"
              description="Invite people, set roles and deactivate accounts."
            />
          </li>
          <li>
            <QuickLink
              href={HOME_PATH}
              icon={ClipboardCheckIcon}
              title="Inspections"
              description="Every inspection, from every inspector."
            />
          </li>
        </ul>
        {comingLater.map(({ phase, labels }) => (
          <p key={phase} className="text-sm text-muted-foreground">
            Coming in {phase}: {listFormat.format(labels.map((label) => label.toLowerCase()))}.
          </p>
        ))}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Data
 * ------------------------------------------------------------------ */

/** Read as the signed-in admin, so this also proves RLS lets an admin see everything it should. */
async function readDatabaseSummary(): Promise<DatabaseSummary> {
  const supabase = await createClient();
  const head = { count: "exact", head: true } as const;
  const [profiles, manufacturers, clients, defectCodes, templates] = await Promise.all([
    supabase.from("profiles").select("role, active"),
    supabase.from("manufacturers").select("id", head),
    supabase.from("clients").select("id", head),
    supabase.from("defect_codes").select("code", head),
    supabase.from("templates").select("id", head),
  ]);

  let accounts: DatabaseSummary["accounts"] = null;
  if (!profiles.error) {
    const active = profiles.data.filter((profile) => profile.active);
    accounts = {
      active: active.length,
      admins: active.filter((profile) => profile.role === "admin").length,
      inspectors: active.filter((profile) => profile.role === "inspector").length,
      deactivated: profiles.data.length - active.length,
    };
  }

  const counts = [manufacturers, clients, defectCodes, templates];
  const reference: DatabaseSummary["reference"] = counts.every((result) => !result.error && result.count !== null)
    ? {
        manufacturers: manufacturers.count ?? 0,
        clients: clients.count ?? 0,
        defectCodes: defectCodes.count ?? 0,
        templates: templates.count ?? 0,
      }
    : null;

  return { accounts, reference };
}

const listFormat = new Intl.ListFormat("en-GB", { style: "long", type: "conjunction" });

/* ------------------------------------------------------------------ *
 * Quick links
 * ------------------------------------------------------------------ */

function QuickLink({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        // h-full: cards in one row match height when one description wraps.
        "group flex h-full items-center gap-4 rounded-xl bg-card p-5 shadow-sm ring-1 ring-border outline-none transition-colors",
        "hover:ring-brand-300 focus-visible:ring-3 focus-visible:ring-ring/50",
      )}
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent text-brand-600">
        <Icon aria-hidden className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-base font-bold text-foreground">{title}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </span>
      <ArrowRightIcon aria-hidden className="size-5 shrink-0 text-slate-500 transition-colors group-hover:text-brand-600" />
    </Link>
  );
}
