"use client";

// One inspection module: title in the template's wording, its result, the
// capture form, the inspector comment and the two photo buttons every module
// carries (BUILD_SPEC 8.1). Photos are handed to onFiles; uploading is not
// this component's job.
import { useId, useRef, type ChangeEvent, type ReactNode } from "react";
import { CameraIcon, ImagesIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Status } from "@/lib/design/status";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusPill } from "./status-pill";

export type PhotoSource = "camera" | "library";

type ModuleCardProps = {
  /** Heading in the template's wording, e.g. "Glove Packing Check". */
  title: string;
  status: Status;
  statusLabel?: string;
  description?: ReactNode;
  /** Extra header controls, e.g. a size picker. */
  actions?: ReactNode;
  children?: ReactNode;
  comment: string;
  onCommentChange: (comment: string) => void;
  commentLabel?: string;
  onFiles: (files: File[], source: PhotoSource) => void;
  photoCount?: number;
  /** Read-only, e.g. an approved inspection. */
  disabled?: boolean;
  headingLevel?: 2 | 3;
  id?: string;
  className?: string;
};

export function ModuleCard({
  title,
  status,
  statusLabel,
  description,
  actions,
  children,
  comment,
  onCommentChange,
  commentLabel = "Inspector comment",
  onFiles,
  photoCount = 0,
  disabled = false,
  headingLevel = 2,
  id,
  className,
}: ModuleCardProps) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const commentId = `${uid}-comment`;
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const Heading = headingLevel === 2 ? "h2" : "h3";

  const takeFiles = (source: PhotoSource) => (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Clear the input so choosing the same photo again still fires.
    event.target.value = "";
    if (files.length > 0) onFiles(files, source);
  };

  return (
    <section
      id={id}
      aria-labelledby={titleId}
      data-slot="module-card"
      className={cn("rounded-xl bg-card text-card-foreground shadow-sm ring-1 ring-border", className)}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-border px-5 py-4">
        <div className="min-w-0 space-y-1">
          <Heading id={titleId} className="text-lg leading-snug font-bold text-balance text-foreground">
            {title}
          </Heading>
          {description && <div className="text-sm text-muted-foreground">{description}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          <StatusPill status={status} label={statusLabel} />
        </div>
      </header>

      {children && <div className="space-y-5 px-5 py-5">{children}</div>}

      <footer className="grid gap-4 rounded-b-xl border-t border-border bg-slate-50 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="space-y-2">
          <Label htmlFor={commentId}>{commentLabel}</Label>
          <Textarea
            id={commentId}
            value={comment}
            onChange={(event) => onCommentChange(event.target.value)}
            disabled={disabled}
            placeholder="Anything the report should mention"
            rows={2}
          />
        </div>
        <div className="relative flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled={disabled} onClick={() => camera.current?.click()}>
            <CameraIcon aria-hidden />
            Take photo
          </Button>
          <Button type="button" variant="outline" disabled={disabled} onClick={() => library.current?.click()}>
            <ImagesIcon aria-hidden />
            Add from library
          </Button>
          {photoCount > 0 && (
            <span className="text-sm text-muted-foreground tabular-nums">
              {photoCount} {photoCount === 1 ? "photo" : "photos"}
            </span>
          )}
          {/* Visually hidden rather than display:none, which older iOS Safari
              will not open from a script. */}
          <input
            ref={camera}
            type="file"
            accept="image/*"
            capture="environment"
            tabIndex={-1}
            aria-hidden
            className="sr-only"
            onChange={takeFiles("camera")}
          />
          <input
            ref={library}
            type="file"
            accept="image/*"
            multiple
            tabIndex={-1}
            aria-hidden
            className="sr-only"
            onChange={takeFiles("library")}
          />
        </div>
      </footer>
    </section>
  );
}
