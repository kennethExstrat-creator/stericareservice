"use client";

// The photo slot on every section of the capture screen (BUILD_SPEC 8.1:
// "Take photo" with the rear camera and "Add from library" on every module,
// tagged with the module and what is in focus). A placeholder until the
// photo build: the real component lives in components/capture/photos/ and
// replaces this one with the same props.
import { CameraIcon, ImagesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CaptureFocus } from "@/modules/_framework";

export type PhotoSlotProps = {
  inspectionId: string;
  /** A module key, or a custom module's key: the photo's module tag. */
  moduleKey: string;
  /** The size, hand, defect or box in focus when the photo is taken. */
  focus: CaptureFocus;
};

export function PhotoSlot({ moduleKey }: PhotoSlotProps) {
  return (
    <div data-slot="photo-slot" data-module={moduleKey} className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Button type="button" variant="outline" disabled>
        <CameraIcon aria-hidden />
        Take photo
      </Button>
      <Button type="button" variant="outline" disabled>
        <ImagesIcon aria-hidden />
        Add from library
      </Button>
      <p className="text-sm text-muted-foreground">Photos arrive in the next build</p>
    </div>
  );
}
