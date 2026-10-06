import type { Metadata } from "next";
import { loadManufacturers } from "@/lib/admin/reference";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ManufacturersAdmin } from "./_components/manufacturers-admin";

/**
 * The title checks the role too: Next resolves metadata apart from the page,
 * so a static title would name this page on an inspector's 404. The session
 * is cached per request, so this adds no query.
 */
export async function generateMetadata(): Promise<Metadata> {
  await requireAdmin();
  return { title: "Manufacturers" };
}

/**
 * /admin/manufacturers (BUILD_SPEC 3, 5 and 10): the factories inspections
 * and templates refer to. Inspectors get a 404 from requireAdmin(); a layout
 * is not a security boundary, so the page checks for itself, and RLS lets
 * only admins write.
 *
 * No outer padding or width: the app shell's main area provides both.
 */
export default async function ManufacturersPage({ searchParams }: PageProps<"/admin/manufacturers">) {
  await requireAdmin();
  const supabase = await createClient();
  const [manufacturers, { q }] = await Promise.all([loadManufacturers(supabase), searchParams]);

  return <ManufacturersAdmin manufacturers={manufacturers} initialQuery={typeof q === "string" ? q : ""} />;
}
