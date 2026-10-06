// A photo in a module or the gallery: thumbnail, auto tags, caption and its
// upload state (waiting or uploading with progress, uploaded, or flagged when
// the file needs conversion). Admin and selection controls appear only when
// their handlers are given.
import { CheckIcon, CloudUploadIcon, FileWarningIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { tagLine, type PhotoTags } from "./photo-tags";

export type PhotoState = "pending" | "uploaded" | "flagged";

type PhotoTileProps = {
  /** Thumbnail URL (signed or blob). Absent when the browser could not decode the file. */
  src?: string;
  alt: string;
  tags: PhotoTags;
  caption?: string;
  state: PhotoState;
  /** Upload progress, 0 to 100, while pending. */
  progress?: number;
  includeInReport?: boolean;
  /** Admin only: shows the "Include in report" switch. */
  onIncludeInReportChange?: (include: boolean) => void;
  selected?: boolean;
  /** Shows a selection checkbox. */
  onSelectedChange?: (selected: boolean) => void;
  /** Opens the photo full size. */
  onOpen?: () => void;
  className?: string;
};

const BADGE =
  "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-semibold shadow-xs [&>svg]:size-3.5";

const STATE_BADGE = {
  pending: { Icon: CloudUploadIcon, className: "border-brand-200 bg-brand-50 text-brand-700" },
  uploaded: { Icon: CheckIcon, className: "border-border bg-card text-muted-foreground" },
  flagged: { Icon: FileWarningIcon, className: "border-warn-border bg-warn-tint text-warn" },
} as const;

function stateText(state: PhotoState, progress: number): string {
  if (state === "flagged") return "Needs conversion";
  if (state === "uploaded") return "Uploaded";
  return progress > 0 ? `Uploading ${Math.round(progress)}%` : "Waiting to upload";
}

export function PhotoTile({
  src,
  alt,
  tags,
  caption,
  state,
  progress = 0,
  includeInReport = false,
  onIncludeInReportChange,
  selected = false,
  onSelectedChange,
  onOpen,
  className,
}: PhotoTileProps) {
  const badge = STATE_BADGE[state];
  const clamped = Math.min(100, Math.max(0, progress));

  return (
    <figure
      data-slot="photo-tile"
      data-state={state}
      data-selected={selected || undefined}
      className={cn(
        "relative flex flex-col overflow-hidden rounded-lg bg-card shadow-xs ring-1 ring-border",
        "data-selected:ring-2 data-selected:ring-primary",
        className,
      )}
    >
      <div className="relative aspect-[4/3] bg-slate-100">
        {src ? (
          // Thumbnails are signed or blob URLs, already resized at capture,
          // so there is nothing for next/image to optimise.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={alt} className="size-full object-cover" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 p-3 text-center text-sm text-muted-foreground">
            <FileWarningIcon aria-hidden className="size-6" />
            <span>No preview</span>
            <span className="sr-only">{alt}</span>
          </div>
        )}

        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            className="absolute inset-0 outline-none focus-ring-inset focus-visible:inset-ring-4 focus-visible:inset-ring-white"
          >
            <span className="sr-only">Open photo: {alt}</span>
          </button>
        )}

        {onSelectedChange && (
          <span className="absolute top-2 left-2 inline-flex rounded-md bg-card/95 p-1.5 shadow-xs touch:p-2.5">
            <Checkbox
              checked={selected}
              onCheckedChange={(checked) => onSelectedChange(checked === true)}
              aria-label={`Select photo: ${alt}`}
            />
          </span>
        )}

        <span className={cn(BADGE, badge.className, "absolute top-2 right-2")}>
          <badge.Icon aria-hidden />
          {stateText(state, clamped)}
        </span>

        {includeInReport && (
          <span className={cn(BADGE, "absolute bottom-2 left-2 border-primary bg-primary text-primary-foreground")}>
            <CheckIcon aria-hidden />
            In report
          </span>
        )}

        {state === "pending" && (
          <span
            role="progressbar"
            aria-label={`Upload progress: ${alt}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(clamped)}
            className="absolute inset-x-0 bottom-0 h-1.5 bg-slate-900/20"
          >
            <span className="block h-full bg-primary transition-[width]" style={{ width: `${clamped}%` }} />
          </span>
        )}
      </div>

      <figcaption className="flex flex-1 flex-col gap-1 p-3">
        <p className="text-xs font-medium text-muted-foreground">{tagLine(tags)}</p>
        {caption ? (
          <p className="line-clamp-2 text-sm text-foreground">{caption}</p>
        ) : (
          <p className="text-sm text-muted-foreground">No caption</p>
        )}
        {onIncludeInReportChange && (
          <label className="mt-auto flex items-center justify-between gap-3 pt-2 text-sm font-medium text-foreground">
            Include in report
            <Switch checked={includeInReport} onCheckedChange={onIncludeInReportChange} />
          </label>
        )}
      </figcaption>
    </figure>
  );
}
