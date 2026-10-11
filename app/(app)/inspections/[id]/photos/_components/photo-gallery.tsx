"use client";

// The gallery's body, a viewer: every photo, video and file is added on
// Source Documents, the inspection's first step (Kenneth, 12 October 2026),
// never here. Notices, a section per Media category and per module that has
// photos (categories first, then template order, untagged last), and the
// inspection's files. One viewer spans every section, so the arrow keys
// walk through all the inspection's photos.
import Link from "next/link";
import { useCallback, useMemo, useRef } from "react";
import { FileSearchIcon, ImagesIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { FileList } from "@/components/capture/files";
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
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import {
  countFiles,
  countPhotos,
  EMPTY_TAG_OPTIONS,
  groupByModule,
  groupsLine,
  moduleTitle,
  readOnlyReason,
  type ModuleGroup,
} from "@/lib/inspections/photos/view";
import { mediaCategory, SOURCE_DOCUMENTS_KEY } from "@/lib/inspections/source-documents";

const SECTION = "rounded-xl bg-card p-5 shadow-sm ring-1 ring-border md:p-6";

/** The line under a section's heading: what goes in a category, how to tag an untagged photo, why a module is set apart. */
function groupDescription(group: Pick<ModuleGroup<unknown>, "key" | "included">): string | undefined {
  if (group.key === null) return "Edit a photo to tag it with the category or module it belongs to.";
  const category = mediaCategory(group.key);
  if (category) return category.hint;
  return group.included
    ? undefined
    : "This module is not part of the inspection now. Its photos stay until they are retagged or deleted.";
}

/** The capture screen on Source Documents, where photos and files are added. */
function SourceDocumentsLink({ inspectionId, size }: { inspectionId: string; size?: "sm" }) {
  return (
    <Button asChild variant="outline" size={size}>
      <Link href={`/inspections/${inspectionId}?module=${SOURCE_DOCUMENTS_KEY}`}>
        <FileSearchIcon aria-hidden />
        Go to Source Documents
      </Link>
    </Button>
  );
}

export function PhotoGallery({ inspectionId }: { inspectionId: string }) {
  const state = useInspectionMedia(inspectionId);
  const queue = usePhotoQueue();
  // Where focus goes when a dialog closes on a section that is gone (its last photo deleted).
  const summary = useRef<HTMLParagraphElement>(null);
  const focusSummary = useCallback(() => summary.current?.focus(), []);
  // And when the last file is deleted: the files' heading, which stays.
  const filesHeading = useRef<HTMLHeadingElement>(null);
  const focusFilesHeading = useCallback(() => filesHeading.current?.focus(), []);
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
            {groupsLine(groups)} · {countFiles(files.length)}
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

        {groups.length === 0 ? (
          <Empty className="border border-dashed border-slate-300 bg-card px-6 py-12">
            <EmptyHeader className="max-w-md">
              <EmptyMedia variant="icon" className="size-12 rounded-xl bg-brand-50 text-brand-600">
                <ImagesIcon aria-hidden />
              </EmptyMedia>
              <EmptyTitle>
                <h2 className="text-lg font-bold text-foreground">No Photos Yet</h2>
              </EmptyTitle>
              <EmptyDescription className="text-base text-muted-foreground fine:text-sm">
                Photos added under Media on Source Documents show here, by category.
              </EmptyDescription>
            </EmptyHeader>
            {access.canEdit && (
              <EmptyContent>
                <SourceDocumentsLink inspectionId={inspectionId} />
              </EmptyContent>
            )}
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
                showAddControls={false}
                readOnly={!access.canEdit}
                description={groupDescription(group)}
              />
            </div>
          ))
        )}

        <section aria-labelledby="files-heading" data-slot="gallery-files" className={SECTION}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              {/* A focus target after the last file is deleted, not a control: no ring. */}
              <h2
                ref={filesHeading}
                id="files-heading"
                tabIndex={-1}
                className="text-lg leading-snug font-bold text-foreground outline-none"
              >
                Files
              </h2>
              <p className="text-sm text-muted-foreground tabular-nums">{countFiles(files.length)}</p>
            </div>
            {files.length > 0 ? (
              <FileList
                inspectionId={inspectionId}
                files={files}
                canEditUploaded={access.canEdit}
                canEditQueued={access.canEdit}
                options={options}
                showModule
                focusFallback={focusFilesHeading}
                // As on Source Documents: Preview in a pop-up, Download and Delete as icons; where the file belongs beside its name.
                compactRows
                fileExtra={(file) => <span className="text-sm text-muted-foreground">{moduleTitle(file.moduleKey, options)}</span>}
              />
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="text-sm text-muted-foreground">{access.canEdit ? "No files yet." : "No files."}</p>
                {/* Without photos, the empty card above has it already. */}
                {access.canEdit && groups.length > 0 && <SourceDocumentsLink inspectionId={inspectionId} size="sm" />}
              </div>
            )}
          </div>
        </section>
      </div>

      <PhotoViewer
        photos={viewerPhotos}
        openId={openId}
        onOpenIdChange={setOpenId}
        actions={
          access.isAdmin
            ? (photo) => {
                const shown = ordered.find((entry) => entry.id === photo.id);
                // The report choice needs the photo's row: not while it is read after the upload.
                return shown && shown.state === "uploaded" && !shown.pendingRow ? (
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
