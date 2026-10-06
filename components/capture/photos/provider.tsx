"use client";

// Names the signed-in user for the page's upload queue, so it can start
// straight away, offline included (it needs the user to find the photos
// this device kept for them). The capture screen wraps itself in
// PhotoQueueProvider; the gallery also hands over its server copy of the
// inspection's media with InspectionMediaProvider.
import { createContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { InspectionMedia } from "@/lib/inspections/photos/queries";
import { MediaSeedContext, PhotoUserContext } from "./hooks";
import { photoQueueStore } from "./queue-store";

export function PhotoQueueProvider({ userId, children }: { userId: string; children: ReactNode }) {
  useEffect(() => {
    void photoQueueStore.start(userId);
  }, [userId]);
  return <PhotoUserContext.Provider value={userId}>{children}</PhotoUserContext.Provider>;
}

/** The gallery page's server copy of an inspection's photos and files, and its user. */
export function InspectionMediaProvider({
  userId,
  media,
  children,
}: {
  userId: string;
  media: InspectionMedia;
  children: ReactNode;
}) {
  return (
    <PhotoQueueProvider userId={userId}>
      <MediaSeedContext.Provider value={media}>{children}</MediaSeedContext.Provider>
    </PhotoQueueProvider>
  );
}

/** Opens the gallery's viewer on a photo, so arrow keys step through every module's photos. */
export const PhotoViewerContext = createContext<{ open: (photoId: string) => void } | null>(null);

/** Holds which photo the gallery's viewer shows. */
export function useViewerState(): [string | null, (id: string | null) => void, { open: (photoId: string) => void }] {
  const [openId, setOpenId] = useState<string | null>(null);
  const context = useMemo(() => ({ open: (photoId: string) => setOpenId(photoId) }), []);
  return [openId, setOpenId, context];
}
