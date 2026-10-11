"use client";

// "Add Photos" in the gallery: choose the Media category or the module the
// photos belong to (or leave them untagged, to tag one by one later), then
// take, pick or drop them. They join the upload queue like photos added on
// the capture screen.
import { useId, useState } from "react";
import { PhotoAddControls, useAddPhotos } from "@/components/capture/photos";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MEDIA_CATEGORY_OPTIONS,
  TAG_FIELD_LABEL,
  TAG_GROUP_LABEL,
  type PhotoTagOptions,
} from "@/lib/inspections/photos/view";
import { isMediaCategoryKey } from "@/lib/inspections/source-documents";
import { cn } from "@/lib/utils";

/** Select items cannot have an empty value; this one stands for "not tagged". */
const UNTAGGED = "__untagged__";

export function AddPhotosCard({
  inspectionId,
  options,
  className,
}: {
  inspectionId: string;
  options: PhotoTagOptions;
  className?: string;
}) {
  const id = useId();
  const [moduleKey, setModuleKey] = useState<string | null>(null);
  const addPhotos = useAddPhotos({ inspectionId, moduleKey, focus: null });
  const modules = options.modules.filter((entry) => entry.included && !isMediaCategoryKey(entry.key));
  const chosen = [...MEDIA_CATEGORY_OPTIONS, ...modules].find((entry) => entry.key === moduleKey);

  return (
    <section aria-labelledby={`${id}-heading`} className={cn("flex flex-col gap-4", className)}>
      <div className="space-y-1">
        <h2 id={`${id}-heading`} className="text-lg leading-snug font-bold text-foreground">
          Add Photos
        </h2>
        <p className="text-sm text-muted-foreground">
          They upload in the background: keep working while they go up.
        </p>
      </div>
      {/* Desktop: the drop zone beside the field, top-aligned. iPad landscape: the two buttons
          centred on the field, so they sit level with the select between its label and hint. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-start lg:touch:items-center">
        <Field>
          <FieldLabel htmlFor={`${id}-module`}>{TAG_FIELD_LABEL}</FieldLabel>
          <Select value={moduleKey ?? UNTAGGED} onValueChange={(value) => setModuleKey(value === UNTAGGED ? null : value)}>
            <SelectTrigger id={`${id}-module`} className="w-full" aria-describedby={`${id}-module-hint`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value={UNTAGGED}>Not Tagged (Tag Them Later)</SelectItem>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>{TAG_GROUP_LABEL.categories}</SelectLabel>
                {MEDIA_CATEGORY_OPTIONS.map((entry) => (
                  <SelectItem key={entry.key} value={entry.key}>
                    {entry.title}
                  </SelectItem>
                ))}
              </SelectGroup>
              {modules.length > 0 && (
                <>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>{TAG_GROUP_LABEL.modules}</SelectLabel>
                    {modules.map((entry) => (
                      <SelectItem key={entry.key} value={entry.key}>
                        {entry.title}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </>
              )}
            </SelectContent>
          </Select>
          <FieldDescription id={`${id}-module-hint`}>New photos are tagged with this category or module.</FieldDescription>
        </Field>
        <PhotoAddControls onFiles={addPhotos} target={chosen?.title} />
      </div>
    </section>
  );
}
