import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/qc";
import { AdminScreenLinks, InspectionShortcuts } from "@/components/shell/admin-quick-links";
import {
  AiReportCard,
  AiReviewCard,
  EmailCard,
  SupabaseCard,
  type DatabaseSummary,
} from "@/components/shell/admin-status-cards";
import { getAiStatus } from "@/lib/ai";
import { requireAdmin } from "@/lib/auth/session";
import { getSiteUrl, getSupabasePublicEnv } from "@/lib/env";
import { isAdminClientConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

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
 * The admin home: what waits for an admin (inspections to approve), a link to
 * every admin screen, then the system status: is Supabase wired up, are the
 * sign-in emails set up, are the AI hand-offs connected. This page reads the
 * facts; components/shell shows them (admin-quick-links.tsx and
 * admin-status-cards.tsx), naming the variable to set, never a value: no
 * keys, secrets or webhook URLs reach it.
 */
export default async function AdminOverviewPage() {
  await requireAdmin();

  const supabaseEnv = getSupabasePublicEnv();
  const secretKeySet = isAdminClientConfigured();
  const supabase = await createClient();
  const [database, awaitingApproval] = await Promise.all([readDatabaseSummary(supabase), countAwaitingApproval(supabase)]);
  const ai = getAiStatus();
  // A production build without NEXT_PUBLIC_SITE_URL only knows getSiteUrl()'s
  // localhost fallback, so the email card asks for the variable instead of
  // showing a wrong address. Read with a literal expression (see lib/env.ts).
  const siteUrl =
    process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_SITE_URL?.trim() ? null : getSiteUrl();

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Admin"
        title="Overview"
        description="What is waiting for you, every admin screen and the set-up checks. Only admins see this page."
      />

      <Section id="inspections-waiting" title="Inspections">
        <InspectionShortcuts awaitingApproval={awaitingApproval} />
      </Section>

      <Section id="admin-screens" title="Set-up">
        <AdminScreenLinks />
      </Section>

      <Section id="system-status" title="System status">
        <div className="grid gap-6 lg:grid-cols-2">
          <SupabaseCard env={supabaseEnv} secretKeySet={secretKeySet} database={database} />
          <EmailCard env={supabaseEnv} siteUrl={siteUrl} />
          <AiReviewCard status={ai.review} />
          <AiReportCard status={ai.report} />
        </div>
      </Section>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <h2 id={id} className="text-2xl font-bold tracking-tight text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Data, read as the signed-in admin: this also proves RLS lets an admin
 * see everything it should.
 * ------------------------------------------------------------------ */

type Client = Awaited<ReturnType<typeof createClient>>;

async function readDatabaseSummary(supabase: Client): Promise<DatabaseSummary> {
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

/** Submitted inspections, which an admin approves or reopens: a count only, no rows. Null when it cannot be read. */
async function countAwaitingApproval(supabase: Client): Promise<number | null> {
  const { count, error } = await supabase
    .from("inspections")
    .select("id", { count: "exact", head: true })
    .eq("status", "submitted");
  if (error) {
    console.error("Admin overview: counting the inspections awaiting approval failed", {
      code: error.code,
      message: error.message,
    });
    return null;
  }
  return count;
}
