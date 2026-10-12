"use client";

// The conclusion on the capture screen, in two blocks with no boxes:
// - Decision: the inspector's final result, one grey track of the template's
//   words (PASSED, FAILED, HOLD; docs/DESIGN.md) where the chosen one is the
//   only solid colour on the card; under it, on one muted line, the suggested
//   result (computed from every module, read-only), its pill saying Passed,
//   Failed or On Hold as every result pill does, and why: a reason with one
//   section names it, one with two or more counts them, their names behind
//   Show All (view state, never saved). Then the remark, with a note under it
//   when the final result differs from the suggestion, asking why while the
//   remark is blank (amber edge).
// - Sign-off: who inspected and the date (both automatic; the date can be
//   changed with the picker), and the signature drawn on the pad.
// The layout follows the card's body, not the window (a container query on
// the root): narrower than 896 px, one column the card's full width, a
// hairline above the sign-off; from 896 px (a wide desktop window, the iPads
// in landscape), the two blocks side by side, the step whole on a 13-inch
// iPad. No width cap leaves the card half empty (Kenneth, 13 October 2026).
// The DOM order, so Tab and reading order, is the same in both. Every edit
// goes through useDataUpdater (docs/CAPTURE_KIT.md), built from the latest
// data. The pad lives here too: module folders keep React in Capture.tsx
// (modules/_framework/architecture.test.ts).
import { useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { EraserIcon, Redo2Icon, Undo2Icon } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import type { Status } from "@/lib/design/status";
import type { InspectionResult } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateField, findIssue, issuePathProps, StatusIcon, StatusPill, useDataUpdater, useIssueFocus } from "@/components/qc";
import { fieldIssues, labelFor, moduleTitle, type CaptureProps } from "@/modules/_framework";
import type { ConclusionComputed, ConclusionConfig, ConclusionData } from ".";
import { conclusionReasons, resultWord } from "./calc";
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

/**
 * A segment of the track: grey words on the grey track (slate-700 on
 * slate-100), white under the pointer while it can still be chosen, the
 * chosen one solid in its status colour; read-only, the chosen one keeps its
 * fill. The track's 6 px padding and gaps keep the outer focus ring (2 px
 * clear, 2 px wide) inside the track and off the next segment: a ring inset
 * on solid green would vanish.
 */
const SEGMENT = cn(
  "inline-flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md border border-transparent px-3 text-sm font-semibold tracking-wide text-slate-700 outline-none transition-colors focus-ring",
  "enabled:data-[state=unchecked]:hover:bg-card enabled:data-[state=unchecked]:hover:text-foreground disabled:cursor-not-allowed data-[state=checked]:shadow-sm",
  "touch:h-12 touch:gap-2 touch:text-base [&>svg]:size-4 [&>svg]:shrink-0 touch:[&>svg]:size-5",
);

/** Matches the data schema's limit (TextCellSchema). */
const MAX_REMARK = 2000;

export default function Capture({
  data,
  title,
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
  // The names behind a counted reason: view state only, never saved; folded whenever the step opens.
  const [showAll, setShowAll] = useState(false);

  const computed = evaluation?.computed;
  const suggested = computed?.suggestedResult ?? null;
  const issues = evaluation?.issues ?? [];
  // The not-done error links to these fields too; beside them, only their own issues.
  const dateIssue = findIssue(fieldIssues(issues), ["date"]);
  const inspector = context.inspection.inspector;
  const today = () => isoDateOf(new Date());
  const ids = {
    final: `${baseId}-final`,
    suggested: `${baseId}-suggested`,
    reasons: `${baseId}-reasons`,
    remark: `${baseId}-remark`,
    differs: `${baseId}-differs`,
    inspector: `${baseId}-inspector`,
    date: `${baseId}-date`,
  };

  // The choice's label says what the card's title says in every seed template
  // ("Conclusion"): then only a screen reader hears it, as the choice's name.
  const finalLabel = labelFor(labels, "finalResult");
  const labelHidden = finalLabel.trim().toLowerCase() === title.trim().toLowerCase();

  // Why, the other modules by their titles in the template's wording (6.2
  // rule 11): one section named, two or more counted, their names under Show
  // All. None until the suggestion is calculated, none for a clean pass.
  const reasons =
    computed && suggested
      ? conclusionReasons(
          { result: suggested, failed: computed.failed, notDone: computed.notDone, warned: computed.warned },
          (key) => moduleTitle(context, key),
        )
      : [];
  const counted = reasons.filter((reason) => reason.counted);

  // calc's warning when the final result differs from the suggestion points at
  // the remark: a short note under it (the pill above gives the suggestion),
  // asking why while the remark is blank and can still be written. The screen
  // evaluates a copy a render behind the choice (useDeferredValue), so the
  // note also weighs the choice shown against the suggestion shown: just
  // after FAILED replaces PASSED it never says FAILED differs from Failed.
  const final = data.finalResult;
  const differs =
    final !== null &&
    suggested !== null &&
    final !== suggested &&
    findIssue(fieldIssues(issues), ["remark"])?.code === "final_result_differs";
  const asking = differs && !readOnly && (data.remark === null || data.remark.trim() === "");
  const differsText =
    differs && final !== null ? `${resultWord(labels, final)} differs from the suggestion.${asking ? " Explain why." : ""}` : null;

  return (
    <div ref={root} className="relative min-w-0 @container" onFocusCapture={() => onFocusChange?.({})}>
      <div className="grid gap-6 @4xl:grid-cols-2 @4xl:gap-x-10">
        {/* Decision: the choice, the suggestion under it, the remark. */}
        <div className="min-w-0 space-y-6">
          <div className="space-y-2">
            <span
              id={ids.final}
              className={cn("block text-sm font-medium text-foreground touch:text-base", labelHidden && "sr-only")}
            >
              {finalLabel}
            </span>
            <RadioGroupPrimitive.Root
              aria-labelledby={ids.final}
              aria-describedby={differsText ? ids.differs : undefined}
              value={final ?? ""}
              onValueChange={(next) => {
                if (isResult(next)) update((current) => withFinalResult(current, next, today()));
              }}
              disabled={readOnly}
              orientation="horizontal"
              className="grid w-full max-w-md grid-cols-3 gap-1.5 rounded-lg bg-muted p-1.5"
              {...issuePathProps(["finalResult"])}
            >
              {RESULTS.map((result) => (
                <RadioGroupPrimitive.Item key={result} value={result} className={cn(SEGMENT, CHOSEN[result])}>
                  <StatusIcon status={STATUS_OF[result]} />
                  <span className="truncate">{resultWord(labels, result)}</span>
                </RadioGroupPrimitive.Item>
              ))}
            </RadioGroupPrimitive.Root>
            {/* The line and its button stay put: the names open below them. */}
            <section
              aria-labelledby={ids.suggested}
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground touch:text-base"
            >
              <h3 id={ids.suggested} className="font-sans font-medium">
                {labelFor(labels, "suggestedResult")}
              </h3>
              {suggested ? (
                <StatusPill size="sm" status={STATUS_OF[suggested]} />
              ) : (
                <StatusPill size="sm" status="not_done" label="Not Calculated Yet" />
              )}
              {reasons.length > 0 && <p className="min-w-0">{reasons.map((reason) => reason.brief).join(" ")}</p>}
              {counted.length > 0 && (
                <>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    aria-expanded={showAll}
                    aria-controls={ids.reasons}
                    onClick={() => setShowAll((open) => !open)}
                    className="h-8 px-1.5 touch:h-11 touch:px-2 touch:text-base"
                  >
                    {showAll ? "Show Less" : "Show All"}
                  </Button>
                  <ul id={ids.reasons} hidden={!showAll} className="basis-full space-y-0.5">
                    {counted.map((reason) => (
                      <li key={reason.full}>{reason.full}</li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={ids.remark} className="leading-snug touch:text-base">
              {labelFor(labels, "remark")}
            </Label>
            <Textarea
              id={ids.remark}
              value={data.remark ?? ""}
              maxLength={MAX_REMARK}
              readOnly={readOnly}
              aria-describedby={differsText ? ids.differs : undefined}
              className={cn("min-h-24 touch:min-h-32", asking && "border-warn-solid")}
              onChange={(event) => {
                const remark = event.target.value;
                update((current) => withRemark(current, remark));
              }}
              {...issuePathProps(["remark"])}
            />
            {differsText && (
              <p id={ids.differs} className="flex items-start gap-1.5 text-sm text-warn touch:text-base">
                <StatusIcon status="warn" className="mt-0.5 size-4 shrink-0 touch:mt-1" />
                <span>{differsText}</span>
              </p>
            )}
          </div>
        </div>

        {/* Sign-off: who and when, then the signature. A hairline above it in one column. */}
        <div className="min-w-0 space-y-6 border-t border-border pt-6 @4xl:border-t-0 @4xl:pt-0">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor={ids.inspector} className="leading-snug touch:text-base">
                {labelFor(labels, "inspector")}
              </Label>
              <Input id={ids.inspector} readOnly value={inspector?.name ?? "Not recorded"} />
            </div>
            <DateField
              id={ids.date}
              label={labelFor(labels, "date")}
              value={data.date}
              onValueChange={(value) => update((current) => withDate(current, value ?? ""))}
              error={dateIssue?.level === "error" ? dateIssue.message : null}
              warning={dateIssue?.level === "warning" ? dateIssue.message : null}
              issuePath={["date"]}
              readOnly={readOnly}
            />
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
      </div>
    </div>
  );
}

/** Line width in signature units: about 3 px on an iPad. */
const STROKE_WIDTH = 2.5;

/**
 * Undo, Redo and Clear: quiet ghost buttons, 32 px with a mouse and 44 px on
 * touch, with 16 px text on iPad (the small button stays at 14 px). With
 * nothing to take back they grey out but stay focusable (aria-disabled), as
 * the kit's Stepper does, so keyboard focus is never dropped (docs/DESIGN.md).
 */
const PAD_ACTION =
  "touch:text-base aria-disabled:cursor-not-allowed aria-disabled:text-slate-400 aria-disabled:hover:bg-transparent aria-disabled:hover:text-slate-400";

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

  // Signed: who signed is for screen readers only, since Inspected By shows the
  // name just above. Unsigned: how to sign, or that nobody did.
  const signed = value ? (signer ? `Signed by ${signer}.` : "Signed.") : null;
  const hint = value ? null : readOnly ? "Not signed." : "Sign with a finger, a pen or the mouse.";
  const boxFull = full && !readOnly ? "The box is full: clear it to sign again." : null;

  return (
    <div role="group" aria-labelledby={labelId} data-slot="signature-pad" className={cn("relative space-y-2", className)} {...rest}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span id={labelId} className="text-sm font-medium text-foreground touch:text-base">
          {label}
        </span>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-1">
            <Button
              type="button"
              variant="ghost"
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
              variant="ghost"
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
              variant="ghost"
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
          "block w-full rounded-lg border border-input bg-card text-foreground select-none [-webkit-touch-callout:none]",
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
      {/* Nothing visible left (signed, room to spare): the whole line is for screen readers, so no empty gap remains. */}
      <p
        id={statusId}
        className={cn("text-sm text-muted-foreground touch:text-base", hint === null && boxFull === null && "sr-only")}
      >
        {signed !== null && <span className="sr-only">{signed}</span>}
        {hint}
        {boxFull !== null && ` ${boxFull}`}
      </p>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
