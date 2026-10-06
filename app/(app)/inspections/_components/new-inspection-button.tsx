// "New inspection" above the list: a link to /inspections/new, where the
// client, manufacturer and product type pick the template (BUILD_SPEC 10).
// A pill button that is 44 px tall with 16 px text on touch.
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { INSPECTIONS_PATH } from "@/lib/inspections/search-params";

export const NEW_INSPECTION_PATH = `${INSPECTIONS_PATH}/new`;

export function NewInspectionButton() {
  return (
    <Button asChild>
      <Link href={NEW_INSPECTION_PATH}>
        <PlusIcon aria-hidden />
        New inspection
      </Link>
    </Button>
  );
}
