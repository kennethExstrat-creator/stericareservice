"use client";

// How lab reports and certificates get in (BUILD_SPEC 8.1): PDF or images,
// several at once. On the iPad one button opens the system picker (Files,
// the photo library or the camera); on a desktop files are dropped or chosen.
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { FilePlusIcon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** What inspection-files accepts (docs/DATABASE.md): PDF and the photo types. */
export const FILE_ACCEPT = "application/pdf,.pdf,image/*";

type FileAddControlsProps = {
  onFiles: (files: File[]) => void;
  /** "Add Lab Report". */
  label: string;
  /** What the picker offers; PDFs and images by default. */
  accept?: string;
  /** Beside the button on a desktop: "Drop PDFs or images here, or". */
  hint?: string;
  disabled?: boolean;
  className?: string;
};

function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

export function FileAddControls({
  onFiles,
  label,
  accept = FILE_ACCEPT,
  hint = "Drop PDFs or images here, or",
  disabled = false,
  className,
}: FileAddControlsProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const take = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length > 0) onFiles(files);
  };

  const dropHandlers = disabled
    ? {}
    : {
        onDragEnter: (event: DragEvent) => {
          if (!carriesFiles(event)) return;
          event.preventDefault();
          depth.current += 1;
          setDragging(true);
        },
        onDragOver: (event: DragEvent) => {
          if (!carriesFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        },
        onDragLeave: () => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragging(false);
        },
        onDrop: (event: DragEvent) => {
          if (!carriesFiles(event)) return;
          event.preventDefault();
          depth.current = 0;
          setDragging(false);
          const files = Array.from(event.dataTransfer.files);
          if (files.length > 0) onFiles(files);
        },
      };

  return (
    <div data-slot="file-add" data-dragging={dragging || undefined} className={cn("relative", className)} {...dropHandlers}>
      <div className="fine:hidden">
        <Button type="button" variant="outline" disabled={disabled} onClick={() => input.current?.click()}>
          <FilePlusIcon aria-hidden />
          {label}
        </Button>
      </div>
      <div
        data-dragging={dragging || undefined}
        className={cn(
          "hidden items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-card px-3 py-2 text-sm text-muted-foreground fine:flex",
          "transition-colors data-dragging:border-primary data-dragging:bg-brand-50",
        )}
      >
        <UploadIcon aria-hidden className="size-4 shrink-0 text-brand-600" />
        <p className="min-w-0 flex-1">
          {dragging ? <span className="font-medium text-brand-700">Drop to add</span> : hint}
        </p>
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => input.current?.click()}>
          {label}
        </Button>
      </div>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        data-file-input
        disabled={disabled}
        onChange={take}
      />
    </div>
  );
}
