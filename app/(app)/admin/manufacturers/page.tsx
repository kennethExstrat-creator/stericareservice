import type { Metadata } from "next";
import { loadManufacturerTree } from "@/lib/admin/manufacturers";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ManufacturersAdmin } from "./_components/manufacturers-admin";

/**
 * The title checks the role too: Next resolves metadata apart from the page,
 * so a static title would name this page on an inspector's 404. The session
 * is cached per request, so this adds no query.
 */
export async function generateMetadata(): Promise<Metadata> {
  await requirePermission("manufacturers");
  return { title: "Manufacturers" };
}

/**
 * /admin/manufacturers (BUILD_SPEC 3, 5 and 10): the brands, their operating
 * companies and their factories, which inspections and templates refer to.
 * Someone whose role has no Manufacturers switch gets a 404 from
 * requirePermission(); a layout is not a security boundary, so the page
 * checks for itself, and the database lets only such a role write
 * (has_permission).
 *
 * No outer padding or width: the app shell's main area provides both.
 */
export default async function ManufacturersPage({ searchParams }: PageProps<"/admin/manufacturers">) {
  await requirePermission("manufacturers");
  const supabase = await createClient();
  const [brands, { q }] = await Promise.all([loadManufacturerTree(supabase), searchParams]);

  return <ManufacturersAdmin brands={brands} initialQuery={typeof q === "string" ? q : ""} />;
}
