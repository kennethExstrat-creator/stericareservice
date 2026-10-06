"use client";

// The gallery's body: notices, "Add photos", a section per module that has
// photos (template order, untagged last), and the lab reports and
// certificates. One viewer spans every section, so the arrow keys walk
// through all the inspection's photos.
import { useCallback, useMemo, useRef } from "react";
import { CameraIcon, ImagesIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { FileList, FileSlot } from "@/components/capture/files";
import {
  ModulePhotos,
  PhotoUploadBadge,
  UploadNotices,
  useInspectionMedia,
  usePhotoQueue,
} from "@/components/capture/photos";
import { toViewerPhoto } from "@/components/capture/photos/module-photos";
import { slotFiles, slotPhotos } from "@/components/capture/photos/photo-model";
import { PhotoViewer } from "@/components/capture/photos/photo-viewer";
import { PhotoViewerContext, useViewerState } from "@/components/capture/photos/provider";
import { ReportSwitch } from "@/components/capture/photos/report-choice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  countFiles,
  countPhotos,
  EMPTY_TAG_OPTIONS,
  groupByModule,
  readOnlyReason,
} from "@/lib/inspections/photos/view";
import type { InspectionFileKind } from "@/lib/photos/files";
import { AddPhotosCard } from "./add-photos-card";

/** Modules that carry lab reports or certificates (BUILD_SPEC 8.1), and what a new file there is. */
const FILE_MODULES: Readonly<Record<string, InspectionFileKind>> = {
  force_at_break: "lab_report",
  tensile: "lab_report",
  documents: "certificate",
};

const SECTION = "rounded-xl bg-card p-5 shadow-sm ring-1 ring-border md:p-6";

export function PhotoGallery({ inspectionId }: { inspectionId: string }) {
  const state = useInspectionMedia(inspectionId);
  const queue = usePhotoQueue();
  // Where focus goes when a dialog closes on a section that is gone (its last photo deleted).
  const summary = useRef<HTMLParagraphElement>(null);
  const focusSummary = useCallback(() => summary.current?.focus(), []);
  const [openId, setOpenId, viewer] = useViewerState(focusSummary);

  const media = state.media;
  const options = media?.options ?? EMPTY_TAG_OPTIONS;
  const access = media?.access ?? { canEdit: false, isAdmin: false };
  const photos = useMemo(
    () => slotPhotos({ media, queue, inspectionId, moduleKey: undefined }),
    [media, queue, inspectionId],
  );
  const groups = useMemo(() => groupByModule(photos, options), [photos, options]);
  const ordered = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const viewerPhotos = useMemo(() => ordered.map((photo) => toViewerPhoto(photo, options)), [ordered, options]);
  const files = useMemo(
    () => slotFiles({ files: media?.files ?? [], queue, inspectionId, moduleKey: undefined }),
    [media, queue, inspectionId],
  );

  if (!media) return null;
  const reason = readOnlyReason(media.inspection.status, access);
  const fileModules = options.modules.filter((entry) => entry.included && FILE_MODULES[entry.key]);
  const otherFiles = files.filter((file) => !fileModules.some((entry) => entry.key === file.moduleKey));
  const moduleCount = groups.filter((group) => group.key !== null).length;

  return (
    <PhotoViewerContext.Provider value={viewer}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          {/* A focus target, not a control: no ring (as StatusScreen's title). */}
          <p
            ref={summary}
            tabIndex={-1}
            data-slot="gallery-summary"
            className="text-sm text-muted-foreground tabular-nums outline-none"
            aria-live="polite"
          >
            {countPhotos(photos.length)}
            {moduleCount > 0 ? ` in ${moduleCount} ${moduleCount === 1 ? "module" : "modules"}` : ""} ·{" "}
            {countFiles(files.length)}
          </p>
          <PhotoUploadBadge inspectionId={inspectionId} />
        </div>

        {reason && (
          <Alert>
            <InfoIcon aria-hidden />
            <AlertDescription className="text-foreground">{reason}</AlertDescription>
          </Alert>
        )}
        {media.problems.map((problem) => (
          <Alert key={problem} className="border-warn-border bg-warn-tint text-warn">
            <TriangleAlertIcon aria-hidden />
            <AlertDescription className="text-warn">{problem}</AlertDescription>
          </Alert>
        ))}
        <UploadNotices inspectionId={inspectionId} />

        {access.canEdit && <AddPhotosCard inspectionId={inspectionId} options={options} className={SECTION} />}

        {groups.length === 0 ? (
          <Empty className="border border-dashed border-slate-300 bg-card px-6 py-12">
            <EmptyHeader className="max-w-md">
              <EmptyMedia variant="icon" className="size-12 rounded-xl bg-brand-50 text-brand-600">
                {access.canEdit ? <CameraIcon aria-hidden /> : <ImagesIcon aria-hidden />}
              </EmptyMedia>
              <EmptyTitle>
                <h2 className="text-lg font-bold text-foreground">No photos yet</h2>
              </EmptyTitle>
              <EmptyDescription className="text-base text-muted-foreground fine:text-sm">
                Photos taken in a module on the capture screen show here, grouped by module.
                {access.canEdit ? " You can also add them above." : ""}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          groups.map((group) => (
            <div key={group.key ?? "untagged"} className={SECTION} data-group={group.key ?? "untagged"}>
              <ModulePhotos
                inspectionId={inspectionId}
                moduleKey={group.key}
                title={group.title}
                headingLevel={2}
                variant="gallery"
                showNotices={false}
                readOnly={!access.canEdit}
                description={
                  group.key === null
                    ? "Edit a photo to tag it with the module it belongs to."
                    : group.included
                      ? undefined
                      : "This module is not part of the inspection now. Its photos stay until they are retagged or deleted."
                }
              />
            </div>
          ))
        )}

        {(fileModules.length > 0 || files.length > 0) && (
          <section aria-labelledby="files-heading" className={SECTION}>
            <div className="flex flex-col gap-6">
              <div className="space-y-1">
                <h2 id="files-heading" className="text-lg leading-snug font-bold text-foreground">
                  Lab reports and certificates
                </h2>
                <p className="text-sm text-muted-foreground">PDFs and images, kept as the lab issued them.</p>
              </div>
              {fileModules.map((entry) => (
                <FileSlot
                  key={entry.key}
                  inspectionId={inspectionId}
                  moduleKey={entry.key}
                  kind={FILE_MODULES[entry.key]}
                  title={entry.title}
                  readOnly={!access.canEdit}
                />
              ))}
              {otherFiles.length > 0 && (
                <div className="flex flex-col gap-3">
                  <h3 className="text-base leading-snug font-semibold text-foreground">
                    {fileModules.length > 0 ? "Other files" : "Files"}
                  </h3>
                  <FileList
                    inspectionId={inspectionId}
                    files={otherFiles}
                    canEditUploaded={access.canEdit}
                    canEditQueued={access.canEdit}
                    options={options}
                    showModule
                    focusFallback={focusSummary}
                  />
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      <PhotoViewer
        photos={viewerPhotos}
        openId={openId}
        onOpenIdChange={setOpenId}
        actions={
          access.isAdmin
            ? (photo) => {
                const shown = ordered.find((entry) => entry.id === photo.id);
                return shown && shown.state === "uploaded" ? (
                  <ReportSwitch
                    key={shown.id}
                    inspectionId={inspectionId}
                    photoId={shown.id}
                    includeInReport={shown.includeInReport}
                  />
                ) : null;
              }
            : undefined
        }
      />
    </PhotoViewerContext.Provider>
  );
}
