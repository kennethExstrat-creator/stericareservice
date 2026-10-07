"use client";

// The photo slot of one module on the capture screen (BUILD_SPEC 8.1): the
// module's photos, uploaded or still on this device, and the controls that
// add more. On the iPad "Take Photo" opens the rear camera and "Add From
// Library" picks several; on a desktop several files are dropped or chosen.
// New photos are tagged with the module and with whatever size, hand,
// defect or box is in focus when they are added, processed in the browser
// and uploaded in the background: the inspector never waits.
import { ModulePhotos } from "./module-photos";
import type { PhotoFocus } from "./hooks";

export type PhotoSlotProps = {
  inspectionId: string;
  /** The module (or custom module) on screen. */
  moduleKey: string;
  /** What the inspector has in focus (the module's onFocusChange): size, hand, defect, box. */
  focus?: PhotoFocus | null;
  /** The capture screen's read-only state: approved, or not the user's to edit. */
  readOnly?: boolean;
  /**
   * False when the module card's own "Take Photo" and "Add From Library"
   * buttons add the photos (wire them with useAddPhotos); the slot then
   * shows the photos only.
   */
  showAddControls?: boolean;
  /**
   * False where another slot on the same page shows the notices about photos
   * waiting on this device (a page of two sections: the first slot does).
   */
  showNotices?: boolean;
  /**
   * The section's title, read out after "Photos" on a page of two sections,
   * so the two photo regions have names of their own.
   */
  nameContext?: string;
  className?: string;
};

export function PhotoSlot({
  inspectionId,
  moduleKey,
  focus,
  readOnly,
  showAddControls,
  showNotices,
  nameContext,
  className,
}: PhotoSlotProps) {
  return (
    <ModulePhotos
      inspectionId={inspectionId}
      moduleKey={moduleKey}
      focus={focus}
      readOnly={readOnly}
      showAddControls={showAddControls}
      showNotices={showNotices}
      nameContext={nameContext}
      variant="capture"
      className={className}
    />
  );
}
