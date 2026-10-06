import type { Metadata } from "next";
import { loadClients } from "@/lib/admin/reference";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ClientsAdmin } from "./_components/clients-admin";

/**
 * The title checks the role too: Next resolves metadata apart from the page,
 * so a static title would name this page on an inspector's 404. The session
 * is cached per request, so this adds no query.
 */
export async function generateMetadata(): Promise<Metadata> {
  await requireAdmin();
  return { title: "Clients" };
}

/**
 * /admin/clients (BUILD_SPEC 3, 5 and 10): who inspections are for, with the
 * logo their reports carry. Logos sit in the private client-logos bucket and
 * show through signed URLs made for each render. Inspectors get a 404 from
 * requireAdmin(); a layout is not a security boundary, so the page checks for
 * itself, and RLS lets only admins write.
 *
 * No outer padding or width: the app shell's main area provides both.
 */
export default async function ClientsPage({ searchParams }: PageProps<"/admin/clients">) {
  await requireAdmin();
  const supabase = await createClient();
  const [clients, { q }] = await Promise.all([loadClients(supabase), searchParams]);

  return <ClientsAdmin clients={clients} initialQuery={typeof q === "string" ? q : ""} />;
}
