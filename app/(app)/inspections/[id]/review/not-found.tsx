import type { Metadata } from "next";
import Link from "next/link";
import { SearchXIcon } from "lucide-react";
import { StatusScreen } from "@/components/shell/status-screen";
import { Button } from "@/components/ui/button";
import { INSPECTIONS_PATH } from "@/lib/inspections/search-params";

export const metadata: Metadata = {
  title: "Inspection not found",
};

/**
 * notFound() from the review, inside the app shell: an id that is not an
 * inspection, one that was deleted, or one this user may not see. The words
 * are the same in every case, so the page never tells an inspector whether
 * someone else's inspection exists.
 */
export default function ReviewNotFound() {
  return (
    <StatusScreen
      icon={SearchXIcon}
      eyebrow="Error 404"
      title="Inspection not found"
      description="There is no inspection at this address that you can open. Check the link, or find it in the inspections list."
      actions={
        <Button asChild size="lg">
          <Link href={INSPECTIONS_PATH}>Go to inspections</Link>
        </Button>
      }
    />
  );
}
