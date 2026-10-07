"use client";

// The conclusion on the capture screen: the suggested result (computed from
// every module, read-only), its pill saying Passed, Failed or On hold as every
// result pill does, with why under it as the submit confirmation and the
// review say it; next to it the inspector's final result, chosen in the
// template's words (PASSED, FAILED, HOLD; docs/DESIGN.md), and a warning when
// the two differ; the remark, who inspected and the date (both automatic;
// the date can be changed with the picker), and the signature drawn on the
// pad. Every edit goes through useDataUpdater (docs/CAPTURE_KIT.md), built
// from the latest data. The pad lives here too: module folders keep React
// in Capture.tsx (modules/_framework/architecture.test.ts).
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
import { findIssue, issuePathProps, StatusIcon, StatusPill, useDataUpdater, useIssueFocus } from "@/components/qc";
import { fieldIssues, labelFor, moduleTitle, suggestionReasons, type CaptureProps } from "@/modules/_framework";
import type { ConclusionComputed, ConclusionConfig, ConclusionData } from ".";
import { resultWord } from "./calc";
import { isoDateOf, withDate, withFinalResult, withRemark, withSignature } from "./edit";
import {
  addStroke,
  boxOf,
  canAddStroke,
  encodeStroke,
  MIN_STEP,
  strokePath,
  withoutLastStroke,
  type Point,
  type Signature,
  type SignatureBox,
  type SignatureChange,
} from "./signature";

const RESULTS: readonly InspectionResult[] = ["pass", "fail", "hold"];

const isResult = (value: string): value is InspectionResult => (RESULTS as readonly string[]).includes(value);

const STATUS_OF: Readonly<Record<InspectionResult, Status>> = { pass: "pass", fail: "fail", hold: "hold" };

// Literal classes, so Tailwind sees them: the chosen result in its solid status colour.
const CHOSEN: Readonly<Record<InspectionResult, string>> = {
  pass: "data-[state=checked]:border-pass-solid data-[state=checked]:bg-pass-solid data-[state=checked]:text-pass-solid-foreground",
  fail: "data-[state=checked]:border-fail-solid data-[state=checked]:bg-fail-solid data-[state=checked]:text-fail-solid-foreground",
  hold: "data-[state=checked]:border-hold-solid data-[state=checked]:bg-hold-solid data-[state=checked]:text-hold-solid-foreground",
};

/** The suggested result's pill at 16 px on iPad (docs/DESIGN.md). */
const PILL_TOUCH = "touch:h-9 touch:px-3.5 touch:text-base touch:[&>svg]:size-5";

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
  const update = useDataUpdater(data, onChange);
  const root = useRef<HTMLDivElement>(null);
  useIssueFocus(focusPath, { root });

  const computed = evaluation?.computed;
  const suggested = computed?.suggestedResult ?? null;
  const issues = evaluation?.issues ?? [];
  // The not-done error links to these fields too; beside them, only their own issues.
  const differs = findIssue(fieldIssues(issues), ["finalResult"]);
  const dateIssue = findIssue(fieldIssues(issues), ["date"]);
  const inspector = context.inspection.inspector;
  const today = () => isoDateOf(new Date());
  const ids = {
    suggested: `${baseId}-suggested`,
    final: `${baseId}-final`,
    differs: `${baseId}-differs`,
    remark: `${baseId}-remark`,
    inspector: `${baseId}-inspector`,
    date: `${baseId}-date`,
    dateIssue: `${baseId}-date-issue`,
  };

  // Why, a line each, the other modules by their titles in the template's
  // wording (6.2 rule 11); none until the suggestion is calculated.
  const reasons =
    computed && suggested
      ? suggestionReasons(
          { result: suggested, failed: computed.failed, notDone: computed.notDone, warned: computed.warned },
          (key) => moduleTitle(context, key),
        )
      : [];

  return (
    <div ref={root} className="min-w-0 space-y-6" onFocusCapture={() => onFocusChange?.({})}>
      <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section aria-labelledby={ids.suggested} className="min-w-0 space-y-2 rounded-lg border border-border bg-muted px-4 py-3">
          <h3 id={ids.suggested} className="text-sm font-medium text-foreground touch:text-base">
            {labelFor(labels, "suggestedResult")}
          </h3>
          {suggested ? (
            <StatusPill status={STATUS_OF[suggested]} className={PILL_TOUCH} />
          ) : (
            <StatusPill status="not_done" label="Not calculated yet" className={PILL_TOUCH} />
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
            aria-describedby={differs ? ids.differs : undefined}
            value={data.finalResult ?? ""}
            onValueChange={(next) => {
              if (isResult(next)) update((current) => withFinalResult(current, next, today()));
            }}
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
            <p
              id={ids.differs}
              className="flex items-start gap-2 rounded-md border border-warn-border bg-warn-tint px-3 py-2 text-sm text-warn touch:text-base"
            >
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
          onChange={(event) => {
            const remark = event.target.value;
            update((current) => withRemark(current, remark));
          }}
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
            onChange={(event) => {
              const value = event.target.value;
              update((current) => withDate(current, value));
            }}
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
        onChange={(change) => update((current) => withSignature(current, change(current.signature), today()))}
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

/**
 * Undo, Redo and Clear: 16 px text on iPad (the small button stays at 14 px).
 * With nothing to take back they grey out but stay focusable (aria-disabled),
 * as the kit's Stepper does, so keyboard focus is never dropped (docs/DESIGN.md).
 */
const PAD_ACTION =
  "touch:text-base aria-disabled:cursor-not-allowed aria-disabled:text-slate-400 aria-disabled:hover:border-input aria-disabled:hover:bg-card aria-disabled:hover:text-slate-400";

/** A stroke taken back with Undo, with the box it was drawn in. */
type UndoneStroke = { readonly stroke: number[]; readonly box: SignatureBox };

type SignaturePadProps = {
  value: Signature | null;
  /**
   * Hands an edit of the signature to the module, which applies it to the
   * latest one (useDataUpdater): a stroke drawn while an earlier edit has
   * not been rendered yet is added to it, never in its place.
   */
  onChange: (change: SignatureChange) => void;
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
export function SignaturePad({ value, onChange, label, signer, readOnly = false, className, ...rest }: SignaturePadProps) {
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const statusId = `${baseId}-status`;
  const surface = useRef<SVGSVGElement>(null);
  const live = useRef<SVGPathElement>(null);
  const drawing = useRef<{ pointerId: number; box: SignatureBox; points: Point[] } | null>(null);
  // Strokes taken back with Undo, latest last; a new stroke or Clear empties it.
  const [undone, setUndone] = useState<UndoneStroke[]>([]);
  const [announcement, setAnnouncement] = useState("");

  // New strokes go into the stored box, so an older signature keeps its scale.
  const box = boxOf(value);
  const strokes = value?.strokes ?? [];
  const full = !canAddStroke(value);

  const toBox = (event: { clientX: number; clientY: number }, target: SignatureBox): Point => {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: ((event.clientX - rect.left) / rect.width) * target.width,
      y: ((event.clientY - rect.top) / rect.height) * target.height,
    };
  };

  const drawLive = (points: readonly Point[]) => {
    live.current?.setAttribute("d", strokePath(points.flatMap((point) => [point.x, point.y])));
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (readOnly || full || !event.isPrimary) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const points = [toBox(event, box)];
    drawing.current = { pointerId: event.pointerId, box, points };
    drawLive(points);
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const current = drawing.current;
    if (!current || current.pointerId !== event.pointerId) return;
    // Coalesced events keep a fast pen stroke smooth where the browser batches moves.
    const native = event.nativeEvent;
    const moves = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    for (const move of moves.length > 0 ? moves : [native]) {
      const point = toBox(move, current.box);
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
    const stroke = encodeStroke(current.points, current.box);
    if (stroke.length === 0) return;
    setUndone([]);
    onChange((signature) => addStroke(signature, stroke, current.box));
  };

  const undo = () => {
    if (strokes.length === 0) return;
    setUndone([...undone, { stroke: strokes[strokes.length - 1], box }]);
    onChange(withoutLastStroke);
    setAnnouncement("Last stroke removed.");
  };

  const redo = () => {
    const last = undone[undone.length - 1];
    if (!last) return;
    setUndone(undone.slice(0, -1));
    onChange((signature) => addStroke(signature, last.stroke, last.box));
    setAnnouncement("Stroke restored.");
  };

  const clear = () => {
    // Nothing to clear: the strokes taken back with Undo stay for Redo.
    if (strokes.length === 0) return;
    setUndone([]);
    onChange(() => null);
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={PAD_ACTION}
              onClick={undo}
              aria-disabled={strokes.length === 0}
            >
              <Undo2Icon aria-hidden />
              Undo
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={PAD_ACTION}
              onClick={redo}
              aria-disabled={undone.length === 0}
            >
              <Redo2Icon aria-hidden />
              Redo
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={PAD_ACTION}
              onClick={clear}
              aria-disabled={strokes.length === 0}
            >
              <EraserIcon aria-hidden />
              Clear
            </Button>
          </div>
        )}
      </div>
      <svg
        ref={surface}
        viewBox={`0 0 ${box.width} ${box.height}`}
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
        style={{ aspectRatio: `${box.width} / ${box.height}` }}
        className={cn(
          "block w-full max-w-2xl rounded-lg border border-input bg-card text-foreground select-none [-webkit-touch-callout:none]",
          readOnly ? "bg-muted" : "cursor-crosshair touch-none",
        )}
      >
        <line
          x1={box.width * 0.04}
          x2={box.width * 0.96}
          y1={box.height * 0.78}
          y2={box.height * 0.78}
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
