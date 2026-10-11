"use client";

// A file shown on the page instead of in a new tab (Source Documents): a
// PDF in the browser's own viewer, a photo as an image, anything else with
// a Download button. The URL is the file's signed link (24 hours).
import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type PreviewKind = "pdf" | "image" | "video" | "other";

export function previewKind(name: string): PreviewKind {
  if (/\.pdf$/i.test(name)) return "pdf";
  if (/\.(jpe?g|png|webp|gif)$/i.test(name)) return "image";
  if (/\.(mp4|m4v|mov|webm)$/i.test(name)) return "video";
  return "other";
}

/** The signed link, asking the browser to save the file under its name instead of showing it. */
export function downloadUrl(url: string, name: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(name)}`;
}

export function FilePreviewDialog({
  file,
  onClose,
}: {
  /**
   * kind: what it is, where its name does not say (Media's "Photo 3");
   * by its name otherwise. downloadName: the name it is saved under, when
   * not its name.
   */
  file: { name: string; url: string; kind?: PreviewKind; downloadName?: string } | null;
  onClose: () => void;
}) {
  const kind = file ? (file.kind ?? previewKind(file.name)) : "other";
  const saveAs = file ? (file.downloadName ?? file.name) : "";
  return (
    <Dialog open={file !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[min(90dvh,60rem)] w-full flex-col gap-4 p-4 sm:max-w-5xl touch:p-5" data-testid="file-preview">
        <DialogHeader className="flex-row items-center gap-3 pr-10">
          <DialogTitle className="min-w-0 flex-1 truncate text-base">{file?.name}</DialogTitle>
          <DialogDescription className="sr-only">A preview of the file.</DialogDescription>
          {file && (
            <Button asChild variant="outline" size="sm">
              <a href={downloadUrl(file.url, saveAs)} download={saveAs}>
                <DownloadIcon aria-hidden />
                Download
              </a>
            </Button>
          )}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg bg-muted ring-1 ring-border">
          {file && kind === "pdf" && <iframe src={file.url} title={file.name} className="size-full border-0 bg-white" />}
          {file && kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element -- a signed link to a private file: not for next/image
            <img src={file.url} alt={file.name} className="size-full object-contain" />
          )}
          {file && kind === "video" && (
            <video src={file.url} controls playsInline className="size-full bg-black object-contain">
              <track kind="captions" />
            </video>
          )}
          {file && kind === "other" && (
            <p className="flex size-full items-center justify-center p-6 text-center text-muted-foreground">
              This file cannot be shown here. Download it to open it.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
