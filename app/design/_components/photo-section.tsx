"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PhotoTile, type PhotoState, type PhotoTags } from "@/components/qc";
import { DesignSection } from "./design-section";

type DemoPhoto = {
  id: string;
  src?: string;
  alt: string;
  tags: PhotoTags;
  caption?: string;
  state: PhotoState;
  progress?: number;
  includeInReport: boolean;
  selected: boolean;
};

const PHOTOS: DemoPhoto[] = [
  {
    id: "uploading",
    src: "/design/photo-glove.svg",
    alt: "Glove on the measuring board",
    tags: { module: "Dimensions", size: "M" },
    caption: "Length measured against the board",
    state: "pending",
    progress: 45,
    includeInReport: false,
    selected: false,
  },
  {
    id: "queued",
    src: "/design/photo-carton.svg",
    alt: "Carton 253",
    tags: { module: "Carton sampling", size: "M", box: "253" },
    state: "pending",
    progress: 0,
    includeInReport: false,
    selected: false,
  },
  {
    id: "uploaded",
    src: "/design/photo-defect.svg",
    alt: "Thin spot on the glove body",
    tags: { module: "Visual", size: "M", defect: "Thin spot on glove body", box: "253" },
    caption: "Thin spot near the palm, second glove from box 253",
    state: "uploaded",
    includeInReport: true,
    selected: false,
  },
  {
    id: "flagged",
    alt: "IMG_0042.HEIC",
    tags: { module: "Labelling", size: "L" },
    caption: "Uploaded as the original: this browser could not convert it",
    state: "flagged",
    includeInReport: false,
    selected: false,
  },
  {
    id: "selected",
    src: "/design/photo-label.svg",
    alt: "Dispenser box side panel",
    tags: { module: "Labelling", size: "S", box: "118" },
    caption: "Lot and dates match the carton",
    state: "uploaded",
    includeInReport: false,
    selected: true,
  },
];

export function PhotoSection() {
  const [photos, setPhotos] = useState(PHOTOS);
  const update = (id: string, change: Partial<DemoPhoto>) =>
    setPhotos((current) => current.map((photo) => (photo.id === id ? { ...photo, ...change } : photo)));

  return (
    <DesignSection
      id="photos"
      title="Photo tiles"
      description="Every state a photo goes through: waiting and uploading (with progress), uploaded, and flagged when the browser could not convert the file. Tags come from where the photo was taken. Admins see the report switch; galleries add selection."
      source="app-specific (BUILD_SPEC 8.1)"
    >
      <ul className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 2xl:grid-cols-5">
        {photos.map((photo) => (
          <li key={photo.id} className="flex">
            <PhotoTile
              className="w-full"
              src={photo.src}
              alt={photo.alt}
              tags={photo.tags}
              caption={photo.caption}
              state={photo.state}
              progress={photo.progress}
              includeInReport={photo.includeInReport}
              onIncludeInReportChange={(includeInReport) => update(photo.id, { includeInReport })}
              selected={photo.selected}
              onSelectedChange={(selected) => update(photo.id, { selected })}
              onOpen={() => toast.info(`Would open “${photo.alt}” full size`)}
            />
          </li>
        ))}
      </ul>
    </DesignSection>
  );
}
