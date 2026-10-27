// Defects found against the acceptance limit (the design's page 6): "2 found ·
// accept ≤ 10" over a track that ends at the reject number, filled in blue
// to the count found, its last step (the reject point) tinted red. A count
// that reaches the reject number fills the track in fail red.
import { trackGeometry } from "@/lib/report/geometry";
import { cn } from "@/lib/utils";
import { TYPE } from "./theme";

export type TrackBarProps = {
  found: number;
  /** The accept number: at most this many may be found. */
  accept: number;
  /** The reject number; accept + 1 when left out. */
  reject?: number | null;
  /** Replaces "accept ≤ 10": a template's own words. */
  limitText?: string;
  className?: string;
};

/** "accept ≤ 10", or "accept 0" where nothing may be found. */
export function acceptText(accept: number): string {
  return accept === 0 ? "accept 0" : `accept ≤ ${accept}`;
}

export function TrackBar({ found, accept, reject, limitText, className }: TrackBarProps) {
  const track = trackGeometry({ found, accept, reject });
  return (
    <div data-slot="report-track-bar" data-over={track.over || undefined} className={cn("flex flex-col gap-[1.2mm]", className)}>
      <p className={cn("text-slate-900 tabular-nums", TYPE.small)}>
        <span className="text-[11pt] font-bold">{found}</span> found · {limitText ?? acceptText(accept)}
      </p>
      <div aria-hidden className="relative h-[2.6mm] overflow-hidden rounded-full bg-slate-200">
        <span
          data-slot="report-reject-zone"
          className="absolute inset-y-0 right-0 bg-fail-border"
          style={{ left: `${(track.rejectFrom * 100).toFixed(3)}%` }}
        />
        {track.fill > 0 && (
          <span
            data-slot="report-track-fill"
            className={cn("absolute inset-y-0 left-0 rounded-full", track.over ? "bg-fail-solid" : "bg-brand-600")}
            style={{ width: `${(track.fill * 100).toFixed(3)}%` }}
          />
        )}
      </div>
    </div>
  );
}
