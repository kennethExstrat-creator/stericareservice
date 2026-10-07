import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { InspectionMediaProvider } from "@/components/capture/photos";
import { PageHeader } from "@/components/qc";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { loadInspectionMedia } from "@/lib/inspections/photos/queries";
import { createClient } from "@/lib/supabase/server";
import { PhotoGallery } from "./_components/photo-gallery";

/**
 * Loads the inspection's photos and files once per request, for the title
 * and the page, through the signed-in user's client: Row Level Security
 * returns nothing for an inspection this user may not read, which becomes
 * the same 404 as an inspection that does not exist.
 */
const loadMedia = cache(async (inspectionId: string) => loadInspectionMedia(await createClient(), inspectionId));

/** The title names the inspection, so it checks the session and the inspection first. */
export async function generateMetadata({ params }: PageProps<"/inspections/[id]/photos">): Promise<Metadata> {
  await requireUser();
  const { id } = await params;
  const result = await loadMedia(id);
  if (result.kind === "not_found") notFound();
  return { title: result.kind === "ok" ? `Photos · ${result.media.inspection.refNo}` : "Photos" };
}

/**
 * /inspections/[id]/photos (BUILD_SPEC 8.1): every photo of an inspection,
 * grouped by module in the template's order, full size with arrow keys,
 * retag, caption and delete while the user may change the inspection, the
 * admin's report choice, and the lab reports and certificates. The page
 * renders inside the app shell, so it sets no padding of its own.
 */
export default async function InspectionPhotosPage({ params }: PageProps<"/inspections/[id]/photos">) {
  const user = await requireUser();
  const { id } = await params;
  const result = await loadMedia(id);
  if (result.kind === "not_found") notFound();
  // The app's error screen offers Try again; nothing on this page works without the list.
  if (result.kind === "error") throw new Error(result.message);
  const { media } = result;

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeader
        eyebrow={media.inspection.refNo}
        title="Photos and files"
        actions={
          <Button asChild variant="outline">
            <Link href={`/inspections/${id}`}>
              <ArrowLeftIcon aria-hidden />
              Back to inspection
            </Link>
          </Button>
        }
      />
      <InspectionMediaProvider userId={user.id} media={media}>
        <PhotoGallery inspectionId={id} />
      </InspectionMediaProvider>
    </div>
  );
}
