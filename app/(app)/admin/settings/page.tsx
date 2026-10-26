import type { Metadata } from "next";
import { PageHeader } from "@/components/qc";
import { EmailCard, SupabaseCard, type DatabaseSummary } from "@/components/shell/admin-status-cards";
import { requireAdmin } from "@/lib/auth/session";
import { getSiteUrl, getSupabasePublicEnv } from "@/lib/env";
import { isAdminClientConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Checks the role too, so the title never names this page on an inspector's 404 (see /admin). */
export async function generateMetadata(): Promise<Metadata> {
  await requireAdmin();
  return { title: "General Settings" };
}

/**
 * Admin > General Settings: is Supabase wired up, are the sign-in emails set
 * up. The admin overview showed them until it became the dashboard (Kenneth,
 * 27 October 2026: "these looks more like should be in general settings or
 * AI settings"); the Steri-AI hand-offs' cards went to Steri-AI Settings'
 * General. This page reads the facts; components/shell/admin-status-cards.tsx
 * shows them, naming the variable to set, never a value: no keys or secrets
 * reach it.
 *
 * Inspectors get a 404 from requireAdmin(); a layout is not a security
 * boundary, so the page checks for itself. No outer padding or width: the
 * app shell's main area provides both.
 */
export default async function GeneralSettingsPage() {
  await requireAdmin();

  const supabaseEnv = getSupabasePublicEnv();
  const secretKeySet = isAdminClientConfigured();
  const database = await readDatabaseSummary(await createClient());
  // A production build without NEXT_PUBLIC_SITE_URL only knows getSiteUrl()'s
  // localhost fallback, so the email card asks for the variable instead of
  // showing a wrong address. Read with a literal expression (see lib/env.ts).
  const siteUrl =
    process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_SITE_URL?.trim() ? null : getSiteUrl();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Admin" title="General Settings" />
      <div className="grid gap-6 lg:grid-cols-2">
        <SupabaseCard env={supabaseEnv} secretKeySet={secretKeySet} database={database} />
        <EmailCard env={supabaseEnv} siteUrl={siteUrl} />
      </div>
    </div>
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
