"use client";

// Names the signed-in user for the page's upload queue, so it can start
// straight away, offline included (it needs the user to find the photos
// this device kept for them). The capture screen wraps itself in
// PhotoQueueProvider; the gallery also hands over its server copy of the
// inspection's media with InspectionMediaProvider. Both hand over
// Steri-AI's describing of photos (the describePhotos Server Action) to a
// role with Steri-AI Reading: the photo's dialog and the Report page use it.
import { createContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { DescribePhotos } from "@/lib/inspections/photos/descriptions";
import type { InspectionMedia } from "@/lib/inspections/photos/queries";
import { MediaSeedContext, PhotoDescribeContext, PhotoUserContext } from "./hooks";
import { photoQueueStore } from "./queue-store";

export function PhotoQueueProvider({
  userId,
  describe,
  children,
}: {
  userId: string;
  /** describePhotos, for a role with Steri-AI Reading; left out otherwise. */
  describe?: DescribePhotos;
  children: ReactNode;
}) {
  useEffect(() => {
    void photoQueueStore.start(userId);
  }, [userId]);
  return (
    <PhotoUserContext.Provider value={userId}>
      <PhotoDescribeContext.Provider value={describe ?? null}>{children}</PhotoDescribeContext.Provider>
    </PhotoUserContext.Provider>
  );
}

/** The gallery page's server copy of an inspection's photos and files, and its user. */
export function InspectionMediaProvider({
  userId,
  media,
  describe,
  children,
}: {
  userId: string;
  media: InspectionMedia;
  /** describePhotos, for a role with Steri-AI Reading; left out otherwise. */
  describe?: DescribePhotos;
  children: ReactNode;
}) {
  return (
    <PhotoQueueProvider userId={userId} describe={describe}>
      <MediaSeedContext.Provider value={media}>{children}</MediaSeedContext.Provider>
    </PhotoQueueProvider>
  );
}

export interface GalleryViewer {
  /** Opens the gallery's viewer on a photo, so arrow keys step through every module's photos. */
  open: (photoId: string) => void;
  /** Where keyboard focus goes when a whole module section leaves the page (its last photo deleted). */
  focusFallback?: () => void;
}

export const PhotoViewerContext = createContext<GalleryViewer | null>(null);

/** Holds which photo the gallery's viewer shows. */
export function useViewerState(focusFallback?: () => void): [string | null, (id: string | null) => void, GalleryViewer] {
  const [openId, setOpenId] = useState<string | null>(null);
  const context = useMemo(() => ({ open: (photoId: string) => setOpenId(photoId), focusFallback }), [focusFallback]);
  return [openId, setOpenId, context];
}
