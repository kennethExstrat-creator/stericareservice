"use client";

// The conclusion on the capture screen: the suggested result (computed from
// every module, read-only) next to the inspector's final result, a warning
// when the two differ, the remark, who inspected and the date (both
// automatic; the date can be changed with the picker), and the signature
// drawn on the pad. The pad lives here too: module folders keep React in
// Capture.tsx (modules/_framework/architecture.test.ts).
import { useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { EraserIcon, Redo2Icon, TriangleAlertIcon, Undo2Icon } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import type { Status } from "@/lib/design/status";
import type { InspectionResult } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { findIssue, issuePathProps, StatusIcon, StatusPill, useIssueFocus } from "@/components/qc";
import { labelFor, type CaptureProps } from "@/modules/_framework";
import type { ConclusionComputed, ConclusionConfig, ConclusionData } from ".";
import { moduleName, resultWord } from "./calc";
import { isoDateOf, withDate, withFinalResult, withRemark, withSignature } from "./edit";
import {
  addStroke,
  canAddStroke,
  encodeStroke,
  MIN_STEP,
  SIGNATURE_HEIGHT,
  SIGNATURE_WIDTH,
  strokePath,
  withoutLastStroke,
  type Point,
  type Signature,
} from "./signature";

const RESULTS: readonly InspectionResult[] = ["pass", "fail", "hold"];

const STATUS_OF: Readonly<Record<InspectionResult, Status>> = { pass: "pass", fail: "fail", hold: "hold" };

// Literal classes, so Tailwind sees them: the chosen result in its solid status colour.
const CHOSEN: Readonly<Record<InspectionResult, string>> = {
  pass: "data-[state=checked]:border-pass-solid data-[state=checked]:bg-pass-solid data-[state=checked]:text-pass-solid-foreground",
  fail: "data-[state=checked]:border-fail-solid data-[state=checked]:bg-fail-solid data-[state=checked]:text-fail-solid-foreground",
  hold: "data-[state=checked]:border-hold-solid data-[state=checked]:bg-hold-solid data-[state=checked]:text-hold-solid-foreground",
};

/** Matches the data schema's limit (TextCellSchema). */
const MAX_REMARK = 2000;

export default function Capture({
  data,
  labels,
  context,
  evaluation,
  focusPath,
  readOnly,
  onChange,
  onFocusChange,
}: CaptureProps<ConclusionData, ConclusionConfig, ConclusionComputed>) {
  const baseId = useId();
  const root = useRef<HTMLDivElement>(null);
  useIssueFocus(focusPath, { root });

  const computed = evaluation?.computed;
  const suggested = computed?.suggestedResult ?? null;
  const issues = evaluation?.issues ?? [];
  const differs = findIssue(issues, ["finalResult"]);
  const dateIssue = findIssue(issues, ["date"]);
  const inspector = context.inspection.inspector;
  const today = () => isoDateOf(new Date());
  const ids = {
    suggested: `${baseId}-suggested`,
    final: `${baseId}-final`,
    remark: `${baseId}-remark`,
    inspector: `${baseId}-inspector`,
    date: `${baseId}-date`,
    dateIssue: `${baseId}-date-issue`,
  };

  const reasons = computed
    ? [
        computed.failed?.length ? `Failed: ${computed.failed.map(moduleName).join(", ")}.` : null,
        computed.notDone?.length ? `Not done: ${computed.notDone.map(moduleName).join(", ")}.` : null,
        computed.warned?.length ? `Warnings: ${computed.warned.map(moduleName).join(", ")}.` : null,
      ].filter((reason): reason is string => reason !== null)
    : [];

  return (
    <div ref={root} className="min-w-0 space-y-6" onFocusCapture={() => onFocusChange?.({})}>
      <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section aria-labelledby={ids.suggested} className="min-w-0 space-y-2 rounded-lg border border-border bg-muted px-4 py-3">
          <h3 id={ids.suggested} className="text-sm font-medium text-foreground touch:text-base">
            {labelFor(labels, "suggestedResult")}
          </h3>
          {suggested ? (
            <StatusPill status={STATUS_OF[suggested]} label={resultWord(labels, suggested)} />
          ) : (
            <StatusPill status="not_done" label="Not calculated yet" />
          )}
          {suggested === "hold" && reasons.length === 0 && (
            <p className="text-sm text-muted-foreground touch:text-base">No module has a result yet.</p>
          )}
          {reasons.length > 0 && (
            <ul className="space-y-0.5 text-sm text-muted-foreground touch:text-base">
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </section>

        <div className="min-w-0 space-y-2">
          <span id={ids.final} className="block text-sm font-medium text-foreground touch:text-base">
            {labelFor(labels, "finalResult")}
          </span>
          <RadioGroupPrimitive.Root
            aria-labelledby={ids.final}
            value={data.finalResult ?? ""}
            onValueChange={(next) => onChange(withFinalResult(data, next as InspectionResult, today()))}
            disabled={readOnly}
            orientation="horizontal"
            className="grid grid-cols-3 gap-2"
            {...issuePathProps(["finalResult"])}
          >
            {RESULTS.map((result) => (
              <RadioGroupPrimitive.Item
                key={result}
                value={result}
                className={cn(
                  "inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-input bg-card px-2 text-sm font-bold text-foreground outline-none transition-colors focus-ring hover:border-primary hover:bg-accent touch:h-14 touch:text-base",
                  "disabled:cursor-not-allowed disabled:hover:border-input disabled:hover:bg-card data-[state=checked]:shadow-sm",
                  "[&>svg]:size-4 [&>svg]:shrink-0 touch:[&>svg]:size-5",
                  CHOSEN[result],
                )}
              >
                <StatusIcon status={STATUS_OF[result]} />
                <span className="truncate">{resultWord(labels, result)}</span>
              </RadioGroupPrimitive.Item>
            ))}
          </RadioGroupPrimitive.Root>
          {differs && (
            <p className="flex items-start gap-2 rounded-md border border-warn-border bg-warn-tint px-3 py-2 text-sm text-warn touch:text-base">
              <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              {differs.message}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={ids.remark} className="touch:text-base">
          {labelFor(labels, "remark")}
        </Label>
        <Textarea
          id={ids.remark}
          value={data.remark ?? ""}
          maxLength={MAX_REMARK}
          readOnly={readOnly}
          onChange={(event) => onChange(withRemark(data, event.target.value))}
          {...issuePathProps(["remark"])}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={ids.inspector} className="touch:text-base">
            {labelFor(labels, "inspector")}
          </Label>
          <Input id={ids.inspector} readOnly value={inspector?.name ?? "Not recorded"} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={ids.date} className="touch:text-base">
            {labelFor(labels, "date")}
          </Label>
          <Input
            id={ids.date}
            type="date"
            value={data.date ?? ""}
            readOnly={readOnly}
            aria-describedby={dateIssue ? ids.dateIssue : undefined}
            onChange={(event) => onChange(withDate(data, event.target.value))}
            {...issuePathProps(["date"])}
          />
          {dateIssue && (
            <p id={ids.dateIssue} className="text-sm text-warn touch:text-base">
              {dateIssue.message}
            </p>
          )}
        </div>
      </div>

      <SignaturePad
        value={data.signature}
        onValueChange={(next) => onChange(withSignature(data, next, today()))}
        label={labelFor(labels, "signature")}
        signer={inspector?.name}
        readOnly={readOnly}
        {...issuePathProps(["signature"])}
      />
    </div>
  );
}

/** Line width in signature units: about 3 px on an iPad. */
const STROKE_WIDTH = 2.5;

type SignaturePadProps = {
  value: Signature | null;
  onValueChange: (next: Signature | null) => void;
  /** The template's wording, e.g. "Signature". */
  label: string;
  /** Who signs, for the accessible description. */
  signer?: string | null;
  readOnly?: boolean;
  /** Marks the pad for issue links (useIssueFocus). */
  "data-issue-path"?: string;
  className?: string;
};

/**
 * The signature drawn on the iPad: pointer events, so a finger, an Apple
 * Pencil and a mouse all draw; one width for every line (pressure is
 * ignored); undo, redo and clear; and the same SVG read-only. The stroke
 * being drawn goes straight into one <path>, without a React render per
 * pointer move; it is stored when the pointer lifts (signature.ts:
 * simplified whole-unit points, a few kB in all).
 */
export function SignaturePad({ value, onValueChange, label, signer, readOnly = false, className, ...rest }: SignaturePadProps) {
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const statusId = `${baseId}-status`;
  const surface = useRef<SVGSVGElement>(null);
  const live = useRef<SVGPathElement>(null);
  const drawing = useRef<{ pointerId: number; points: Point[] } | null>(null);
  // Strokes taken back with Undo, latest last; a new stroke or Clear empties it.
  const [undone, setUndone] = useState<number[][]>([]);
  const [announcement, setAnnouncement] = useState("");

  // New strokes go into the stored box, so an older signature keeps its scale.
  const width = value?.width ?? SIGNATURE_WIDTH;
  const height = value?.height ?? SIGNATURE_HEIGHT;
  const strokes = value?.strokes ?? [];
  const full = !canAddStroke(value);

  const toBox = (event: { clientX: number; clientY: number }): Point => {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return { x: ((event.clientX - rect.left) / rect.width) * width, y: ((event.clientY - rect.top) / rect.height) * height };
  };

  const drawLive = (points: readonly Point[]) => {
    live.current?.setAttribute("d", strokePath(points.flatMap((point) => [point.x, point.y])));
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (readOnly || full || !event.isPrimary) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const points = [toBox(event)];
    drawing.current = { pointerId: event.pointerId, points };
    drawLive(points);
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const current = drawing.current;
    if (!current || current.pointerId !== event.pointerId) return;
    // Coalesced events keep a fast pen stroke smooth where the browser batches moves.
    const native = event.nativeEvent;
    const moves = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    for (const move of moves.length > 0 ? moves : [native]) {
      const point = toBox(move);
      const last = current.points[current.points.length - 1];
      if (Math.hypot(point.x - last.x, point.y - last.y) >= MIN_STEP) current.points.push(point);
    }
    drawLive(current.points);
  };

  const endStroke = (event: ReactPointerEvent<SVGSVGElement>, keep: boolean) => {
    const current = drawing.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drawing.current = null;
    live.current?.setAttribute("d", "");
    if (!keep) return;
    const stroke = encodeStroke(current.points, { width, height });
    if (stroke.length === 0) return;
    setUndone([]);
    onValueChange(addStroke(value, stroke));
  };

  const undo = () => {
    if (!value) return;
    setUndone([...undone, value.strokes[value.strokes.length - 1]]);
    onValueChange(withoutLastStroke(value));
    setAnnouncement("Last stroke removed.");
  };

  const redo = () => {
    const stroke = undone[undone.length - 1];
    if (!stroke) return;
    setUndone(undone.slice(0, -1));
    onValueChange(addStroke(value, stroke));
    setAnnouncement("Stroke restored.");
  };

  const clear = () => {
    setUndone([]);
    onValueChange(null);
    setAnnouncement(`${label} cleared.`);
  };

  const status = value
    ? signer
      ? `Signed by ${signer}.`
      : "Signed."
    : readOnly
      ? "Not signed."
      : "Sign in the box with a finger, a pen or the mouse.";

  return (
    <div role="group" aria-labelledby={labelId} data-slot="signature-pad" className={cn("relative space-y-2", className)} {...rest}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <span id={labelId} className="text-sm font-medium text-foreground touch:text-base">
          {label}
        </span>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={undo} disabled={strokes.length === 0}>
              <Undo2Icon aria-hidden />
              Undo
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={redo} disabled={undone.length === 0}>
              <Redo2Icon aria-hidden />
              Redo
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={clear} disabled={strokes.length === 0}>
              <EraserIcon aria-hidden />
              Clear
            </Button>
          </div>
        )}
      </div>
      <svg
        ref={surface}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={labelId}
        aria-describedby={statusId}
        // The pad takes every touch: no scrolling, zooming, callout, selection or size swipe while signing.
        data-no-swipe=""
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => endStroke(event, true)}
        // The browser took the touch (a system gesture): the line was not meant.
        onPointerCancel={(event) => endStroke(event, false)}
        onLostPointerCapture={(event) => endStroke(event, true)}
        style={{ aspectRatio: `${width} / ${height}` }}
        className={cn(
          "block w-full max-w-2xl rounded-lg border border-input bg-card text-foreground select-none [-webkit-touch-callout:none]",
          readOnly ? "bg-muted" : "cursor-crosshair touch-none",
        )}
      >
        <line
          x1={width * 0.04}
          x2={width * 0.96}
          y1={height * 0.78}
          y2={height * 0.78}
          stroke="var(--color-slate-300)"
          strokeWidth={1.5}
          strokeDasharray="6 6"
          aria-hidden
        />
        <g fill="none" stroke="currentColor" strokeWidth={STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round">
          {strokes.map((stroke, index) => (
            <path key={index} d={strokePath(stroke)} />
          ))}
          <path ref={live} d="" />
        </g>
      </svg>
      <p id={statusId} className="text-sm text-muted-foreground touch:text-base">
        {status}
        {full && !readOnly ? " The box is full: clear it to sign again." : ""}
      </p>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
